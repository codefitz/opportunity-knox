"""Verified offline workspace changes. Originals and rollback snapshots are retained."""
from pathlib import Path, PurePosixPath
import hashlib, json, os, shutil, sqlite3, time, uuid

def read(path): return json.loads(Path(path).read_text())
def write(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_name(path.name+'.tmp-'+uuid.uuid4().hex)
    temp.write_text(json.dumps(value,indent=2)+'\n');temp.chmod(0o600);os.replace(temp,path)
def mount(root): return '/files/'+hashlib.sha256(str(root).encode()).hexdigest()[:16]
def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def relative(value):
    p=PurePosixPath(value)
    if not value or p.is_absolute() or any(v in ('..','.') for v in p.parts) or '\\' in value:raise ValueError('Invalid relative document path.')
    return Path(*p.parts)
def safe_child(root, value):
    root=Path(root).resolve(strict=True);rel=relative(value);path=root/rel
    current=root
    for part in rel.parts:
        current=current/part
        if current.is_symlink():raise ValueError('Symbolic links are not allowed in backup destinations.')
    if not path.resolve().is_relative_to(root):raise ValueError('Backup destination is outside its storage root.')
    return path

def regular(path,root):
    p=Path(path);root=Path(root).resolve(strict=True)
    if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root):raise ValueError('A document is unavailable or outside its configured folder.')
    return p

def connection(state): return sqlite3.connect(Path(state)/'board.sqlite')
def rows(db,table): return [json.loads(r[0]) for r in db.execute('SELECT data FROM '+table)]
def config_value(db,key,default=None):
    r=db.execute('SELECT data FROM config WHERE key=?',(key,)).fetchone();return json.loads(r[0]) if r else default

def fingerprint(db):
    h=hashlib.sha256()
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        for row in db.execute('SELECT * FROM "'+table.replace('"','""')+'" ORDER BY 1'):h.update(json.dumps([table,list(row)],sort_keys=True).encode())
    return h.hexdigest()
def documents(db):return rows(db,'documents')
def resolve_document(doc,config):
    for root in config['roots']:
        if doc['storageRoot'] in (mount(root),str(root)):
            return regular(Path(root)/relative(doc['relativePath']),root)
    raise ValueError('A document uses an unconfigured storage root.')
def check_file(doc,path):
    if digest(path)!=doc['sha256']:raise ValueError('A document does not match its saved hash. No workspace change was applied.')

def snapshot(state,config,backup_root=None,fallback=None):
    """Caller stops the board first; snapshot contains all tables and every managed original."""
    db=connection(state)
    try:
        settings=config_value(db,'settings',{})
        root=Path(backup_root) if backup_root else safe_child(config['files'],settings.get('backupSubdir','backups'))
        readonly=[Path(s['hostPath']).resolve() for s in config.get('sourceRoots',[])]+([Path(config['vault']).resolve()] if config.get('vaultReadOnly') and config.get('vault') else [])
        if any(root.resolve()==s or root.resolve().is_relative_to(s) for s in readonly):raise ValueError('Backup destination is a read-only career source.')
        root.mkdir(parents=True,exist_ok=True,mode=0o700)
        name='board-'+time.strftime('%Y-%m-%dT%H-%M-%S',time.gmtime())+'-'+uuid.uuid4().hex[:8]
        partial=root/('.partial-'+name);target=root/name;partial.mkdir(mode=0o700);(partial/'documents').mkdir(mode=0o700)
        try:
            manifest=[]
            for d in documents(db):
                try:p=resolve_document(d,config)
                except (ValueError,OSError):
                    if not fallback or d['id'] not in fallback:raise
                    p=Path(fallback[d['id']])
                check_file(d,p);out=partial/'documents'/d['id'];shutil.copyfile(p,out);out.chmod(0o600);check_file(d,out)
                manifest.append({**d,'backupPath':'documents/'+d['id']})
            dest=sqlite3.connect(partial/'board.sqlite');db.backup(dest);dest.close();(partial/'board.sqlite').chmod(0o600)
            write(partial/'manifest.json',{'format':'opportunity-board-backup','version':1,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'documents':manifest,'restore':'Private full workspace snapshot; restore through Opportunity Knox.'})
            os.replace(partial,target);return target
        except BaseException:shutil.rmtree(partial,ignore_errors=True);raise
    finally:db.close()

def safe_restore(state,restore_id):
    if not restore_id.startswith('restore-') or not all(c in 'restore-0123456789abcdef' for c in restore_id):raise ValueError('Invalid restore identifier.')
    root=Path(state)/'restores'/restore_id
    if root.is_symlink() or not root.resolve().is_relative_to((Path(state)/'restores').resolve()):raise ValueError('Invalid restore location.')
    if not read(root/'restore-report.json').get('validated'):raise ValueError('Restore must pass inspection first.')
    return root

def source_plan(state,config,request):
    kind=request['kind']
    sources=[s['hostPath'] for s in config.get('sourceRoots',[])]+([config['vault']] if config.get('vault') else [])
    if any(not Path(v).is_dir() or not os.access(v,os.R_OK|os.X_OK) for v in sources):raise ValueError('Reconnect or detach unavailable read-only sources before changing the workspace.')
    db=connection(state)
    try:live=fingerprint(db);live_docs=documents(db)
    finally:db.close()
    if kind=='restore':
        root=safe_restore(state,request['restoreId']);db=sqlite3.connect(root/'state'/'board.sqlite')
        try:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Restored database integrity failed.')
            docs=documents(db);source_fingerprint=fingerprint(db)
        finally:db.close()
        paths={d['id']:regular(root/'files'/relative(d['relativePath']),root/'files') for d in docs}
        target=Path(state)/'activated-restores'/request['requestId']/'files'
    elif kind in ('migrate','relink'):
        destination=Path(request['destination']).expanduser()
        if not destination.is_absolute() or destination.is_symlink() or not destination.is_dir():raise ValueError('Choose an existing writable destination folder.')
        destination=destination.resolve()
        # Metadata stays local. Prevent application-state/backup overlap and read-only source writes.
        if destination.is_relative_to(Path(state).resolve()) or Path(state).resolve().is_relative_to(destination):raise ValueError('Document storage must be separate from application state.')
        sources=[Path(s['hostPath']).resolve() for s in config.get('sourceRoots',[])]+([Path(config['vault']).resolve()] if config.get('vaultReadOnly') and config.get('vault') else [])
        if any(destination==s or destination.is_relative_to(s) or s.is_relative_to(destination) for s in sources):raise ValueError('Choose a destination outside read-only career sources and the vault.')
        probe=destination/('.knox-probe-'+uuid.uuid4().hex);probe.write_bytes(b'');probe.unlink()
        docs=live_docs;source_fingerprint=live
        if kind=='migrate':
            paths={d['id']:resolve_document(d,config) for d in docs};target=destination/('opportunity-knox-'+request['requestId'])
        else:
            paths={d['id']:regular(destination/relative(d['relativePath']),destination) for d in docs};target=destination
    else:raise ValueError('Unsupported workspace operation.')
    for d in docs:check_file(d,paths[d['id']])
    return {'kind':kind,'liveFingerprint':live,'sourceFingerprint':source_fingerprint,'documents':docs,'paths':{k:str(v) for k,v in paths.items()},'target':str(target),'bytes':sum(Path(p).stat().st_size for p in paths.values()),'count':len(docs)}

def preview(state,config,request):
    plan=source_plan(state,config,request);write(Path(state)/'maintenance'/('plan-'+request['requestId']+'.json'),{**plan,'request':request,'createdAt':time.time()});return plan

def install(state,config,plan,stop,start):
    """Host callbacks stop/restart only the selected board. Roll back atomically on failure."""
    state=Path(state);request=plan['request'];fresh=source_plan(state,config,request)
    for key in ('liveFingerprint','sourceFingerprint','paths','target','bytes'):
        if fresh[key]!=plan[key]:raise ValueError('Workspace or source files changed after preview. Preview again before applying.')
    target=Path(plan['target']);rollback=state/'maintenance'/('rollback-'+request['requestId']);rollback.mkdir(mode=0o700)
    old_config=read(state/'launcher.json');old_runtime=read(state/'runtime.compose.json');stopped=False;replaced=False
    write(state/'maintenance'/'transaction.json',{'state':'preparing','requestId':plan.get('applyRequestId',request['requestId']),'oldConfig':old_config,'oldRuntime':old_runtime})
    try:
        stop();stopped=True
        # Recheck after stopping so a last in-flight write cannot be discarded.
        db=connection(state)
        try:
            if fingerprint(db)!=plan['liveFingerprint']:raise ValueError('Workspace changed while stopping. Preview again.')
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchall()
        finally:db.close()
        backup=snapshot(state,config,state/'maintenance'/'backups',plan['paths'] if plan['kind']=='relink' else None)
        shutil.copyfile(backup/'board.sqlite',rollback/'board.sqlite');(rollback/'board.sqlite').chmod(0o600)
        write(rollback/'launcher.json',old_config);write(rollback/'runtime.compose.json',old_runtime)
        if plan['kind']!='relink':target.mkdir(parents=True,exist_ok=False,mode=0o700)
        for d in plan['documents']:
            source=Path(plan['paths'][d['id']]);out=target/relative(d['relativePath'])
            if plan['kind']!='relink':out.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copyfile(source,out);out.chmod(0o600)
            check_file(d,out)
        prepared=rollback/'prepared.sqlite'
        source_db=safe_restore(state,request['restoreId'])/'state'/'board.sqlite' if plan['kind']=='restore' else backup/'board.sqlite'
        shutil.copyfile(source_db,prepared);prepared.chmod(0o600);db=sqlite3.connect(prepared)
        try:
            for d in plan['documents']:
                changed={**d,'storageRoot':mount(target),'revision':d.get('revision',1)+1}
                db.execute('UPDATE documents SET data=? WHERE id=?',(json.dumps(changed),d['id']))
            if plan['kind']=='restore':db.execute("INSERT INTO config VALUES('sessions','{}') ON CONFLICT(key) DO UPDATE SET data='{}'")
            settings=config_value(db,'settings',{});backup_subdir=relative(settings.get('backupSubdir','backups'));db.commit()
        finally:db.close()
        # Make the previous workspace recoverable through the new workspace's ordinary backup UI.
        backup_destination=safe_child(target,str(backup_subdir));backup_destination.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copytree(backup,backup_destination/backup.name)
        roots=list(dict.fromkeys([str(target)]+[r for r in config['roots'] if Path(r).is_dir()]))
        new_config={**config,'files':str(target),'roots':roots}
        for suffix in ('-wal','-shm'):Path(str(state/'board.sqlite')+suffix).unlink(missing_ok=True)
        write(state/'maintenance'/'transaction.json',{'state':'switching','requestId':plan.get('applyRequestId',request['requestId']),'rollback':str(rollback),'oldConfig':old_config,'oldRuntime':old_runtime})
        os.replace(prepared,state/'board.sqlite');replaced=True
        if plan['kind']=='restore' and (state/'codex-buddy').exists():shutil.move(state/'codex-buddy',rollback/'codex-buddy')
        start(new_config)
        db=connection(state)
        try:
            for d in documents(db):check_file(d,resolve_document(d,new_config))
        finally:db.close()
        result={'backup':backup.name,'backupLocation':str(backup),'destination':str(target),'documents':len(plan['documents']),'rollback':str(rollback)}
        write(state/'maintenance'/'transaction.json',{'state':'committed','requestId':plan.get('applyRequestId',request['requestId']),'result':{**result,'kind':plan['kind']}})
        return result
    except BaseException:
        if stopped:
            if replaced:
                stop()
                for suffix in ('-wal','-shm'):Path(str(state/'board.sqlite')+suffix).unlink(missing_ok=True)
                shutil.copyfile(rollback/'board.sqlite',state/'board.sqlite')
                if (rollback/'codex-buddy').exists():
                    if (state/'codex-buddy').exists():shutil.move(state/'codex-buddy',rollback/'failed-codex-buddy')
                    shutil.move(rollback/'codex-buddy',state/'codex-buddy')
            write(state/'launcher.json',old_config);write(state/'runtime.compose.json',old_runtime)
            start(old_config)
            write(state/'maintenance'/'transaction.json',{'state':'rolled-back'})
        raise

def idle(state):
    db=connection(state)
    try:
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'buddy_requests' in tables and any(not r.get('finishedAt') for r in rows(db,'buddy_requests')):raise ValueError('Finish or cancel active AI requests before changing the workspace.')
        if 'opportunity_automation' in tables and any(r.get('state') in ('queued','running','cancelling') for r in rows(db,'opportunity_automation')):raise ValueError('Finish or cancel automatic reviews first.')
        if (config_value(db,'vectorIndexJob',{}) or {}).get('status') in ('running','cancelling'):raise ValueError('Stop library indexing first.')
        if any(r.get('reviewStatus')=='running' for r in (config_value(db,'feedbackInbox',{}) or {}).get('items',[])):raise ValueError('Finish feedback reviews first.')
    finally:db.close()

def process_request(state,config,request,stop,start):
    state=Path(state);status=state/'maintenance-status.json';base={'requestId':request['requestId'],'action':request['action'],'kind':request.get('kind',''),'phase':'running'};write(status,base)
    try:
        if request['action']=='preview':
            plan=preview(state,config,request);result={**base,'phase':'previewed','planId':request['requestId'],'input':{'destination':request.get('destination',''),'backupName':request.get('backupName','')},'kind':plan['kind'],'documents':plan['count'],'bytes':plan['bytes'],'destination':plan['target'],'warnings':['The previous workspace and source files will be retained. A full backup is made before activation.','Existing older backups remain in their previous folders; the new folder receives a full pre-change backup.']}
        elif request['action']=='apply':
            plan=read(state/'maintenance'/('plan-'+request['planId']+'.json'))
            if time.time()-plan['createdAt']>1800:raise ValueError('Preview expired. Preview the change again.')
            plan['applyRequestId']=request['requestId']
            idle(state);result={**base,**install(state,config,plan,stop,start),'phase':'succeeded','kind':plan['kind']}
        else:raise ValueError('Unsupported maintenance action.')
        write(status,result);return result
    except BaseException as e:
        write(status,{**base,'phase':'failed','message':str(e)[:1000]});raise


def recover(state,stop,start):
    state=Path(state);journal=state/'maintenance'/'transaction.json'
    if not journal.exists():return False
    entry=read(journal)
    if entry.get('state')=='committed':
        status=read(state/'maintenance-status.json') if (state/'maintenance-status.json').exists() else {}
        if status.get('requestId')==entry.get('requestId') and status.get('phase') in ('queued','running'):
            write(state/'maintenance-status.json',{**status,**entry['result'],'phase':'succeeded'})
        return False
    if entry.get('state')=='preparing':
        write(state/'launcher.json',entry['oldConfig']);write(state/'runtime.compose.json',entry['oldRuntime']);start(entry['oldConfig'])
        write(journal,{'state':'rolled-back'});write(state/'maintenance-status.json',{'phase':'interrupted','message':'Interrupted preparation restarted the original workspace. Preview again to retry.'});return True
    if entry.get('state')!='switching':return False
    rollback=Path(entry['rollback'])
    if not rollback.resolve().is_relative_to((state/'maintenance').resolve()):raise ValueError('Invalid rollback journal; preserve the state folder for inspection.')
    stop()
    for suffix in ('-wal','-shm'):Path(str(state/'board.sqlite')+suffix).unlink(missing_ok=True)
    shutil.copyfile(rollback/'board.sqlite',state/'board.sqlite')
    write(state/'launcher.json',entry['oldConfig']);write(state/'runtime.compose.json',entry['oldRuntime'])
    if (rollback/'codex-buddy').exists():
        if (state/'codex-buddy').exists():shutil.move(state/'codex-buddy',rollback/('interrupted-codex-'+uuid.uuid4().hex))
        shutil.move(rollback/'codex-buddy',state/'codex-buddy')
    start(entry['oldConfig'])
    write(journal,{'state':'rolled-back'})
    write(state/'maintenance-status.json',{'phase':'interrupted','message':'Interrupted workspace change was rolled back to the pre-change workspace. Preview again to retry.'})
    return True
