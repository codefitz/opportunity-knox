"""Launcher-owned Codex bridge; no listening port or copied credentials."""
import json, os, re, shutil, signal, subprocess, tempfile, threading, time
from pathlib import Path

def command(executable, directory, schema, output, model):
    args=[executable,'exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',str(directory),'--output-schema',str(schema),'-o',str(output)]
    for key,value in {'features.shell_tool':'false','features.apps':'false','features.plugins':'false','features.memories':'false','features.request_permissions_tool':'false','skills.bundled.enabled':'false','skills.include_instructions':'false','web_search':'"disabled"','project_doc_max_bytes':'0','approval_policy':'"never"'}.items():args+=['-c',key+'='+value]
    if model!='default':args+=['-m',model]
    return args+['-']

def normalize_models(catalog):
    models=[{'id':'default','name':'Codex default model'}];seen={'default'}
    rows=catalog.get('models',[])
    if not isinstance(rows,list):raise ValueError()
    for row in rows[:1000]:
        if not isinstance(row,dict) or row.get('visibility')!='list':continue
        slug=row.get('slug','');name=row.get('display_name',slug)
        if not isinstance(slug,str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}',slug) or slug in seen:continue
        seen.add(slug);models.append({'id':slug,'name':str(name)[:200]})
    return {'models':models,'suggested':'default','truncated':len(rows)>1000}

class CodexWorker:
    def __init__(self,state_dir,executable=None):
        self.root=Path(state_dir)/'codex-buddy';self.root.mkdir(mode=0o700,exist_ok=True)
        self.executable=executable or shutil.which('codex');self.stop=threading.Event();self.process=None
        self.thread=threading.Thread(target=self.loop,daemon=True);self.thread.start()
    def write(self,path,data):
        temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data),encoding='utf8');temp.chmod(0o600);temp.replace(path)
    def loop(self):
        try:
            login=subprocess.run([self.executable,'login','status'],capture_output=True,text=True,timeout=10) if self.executable else None
            auth=bool(login and login.returncode==0 and 'chatgpt' in (login.stdout+login.stderr).lower())
        except (OSError,subprocess.TimeoutExpired):auth=False
        while not self.stop.is_set():
            self.write(self.root/'status.json',{'ready':bool(self.executable and auth),'time':time.time()})
            for path in self.root.glob('*.request.json'):
                if self.stop.is_set():break
                if path.is_symlink() or not re.fullmatch(r'[a-f0-9-]{36}\.request\.json',path.name):continue
                response=path.with_name(path.name.replace('.request.json','.response.json'))
                cancel=path.with_name(path.name.replace('.request.json','.cancel.json'));progress=path.with_name(path.name.replace('.request.json','.progress.json'))
                try:
                    if path.stat().st_size>1024*1024:raise ValueError()
                    job=json.loads(path.read_text());path.unlink()
                    if job['expiresAt']<time.time() or cancel.exists():continue
                    if job.get('kind')=='models':
                        if not self.executable or not auth:raise RuntimeError('Sign in to Codex with ChatGPT on the host, then restart the board.')
                        try:
                            catalog=subprocess.run([self.executable,'debug','models','-c','model_provider="openai"'],capture_output=True,text=True,timeout=15)
                            if catalog.returncode:raise ValueError()
                            normalized=normalize_models(json.loads(catalog.stdout))
                            self.write(response,{'output':json.dumps(normalized)})
                        except (OSError,ValueError,subprocess.TimeoutExpired):raise RuntimeError('Could not refresh the Codex model catalogue. Update the host CLI or enter a model ID manually.')
                        continue
                    model=job.get('model','default')
                    if not isinstance(job['prompt'],str) or not isinstance(job['schema'],dict) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}',model):raise ValueError()
                    if not self.executable or not auth:raise RuntimeError('Sign in to Codex on the board host, then restart the board.')
                    self.write(self.root/'status.json',{'ready':True,'time':time.time(),'busyUntil':job['expiresAt']})
                    with tempfile.TemporaryDirectory(prefix='knox-codex-') as temp:
                        schema=Path(temp)/'schema.json';schema.write_text(json.dumps(job['schema']));output=Path(temp)/'answer.json'
                        env={k:v for k,v in os.environ.items() if k not in ('OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN')}
                        self.process=subprocess.Popen(command(self.executable,temp,schema,output,model),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,text=True,start_new_session=True,env=env)
                        self.write(progress,{'stage':'running-codex'})
                        first=True
                        deadline=min(job['expiresAt'],time.time()+900)
                        while True:
                            if cancel.exists() or self.stop.is_set() or time.time()>=deadline:
                                try:os.killpg(self.process.pid,signal.SIGKILL)
                                except ProcessLookupError:pass
                                self.process.wait()
                                raise RuntimeError('Codex request cancelled.' if cancel.exists() or self.stop.is_set() else 'Codex request exceeded its configured deadline.')
                            try:
                                self.process.communicate(job['prompt'] if first else None,timeout=.2)
                                break
                            except subprocess.TimeoutExpired:first=False
                        if self.process.returncode or not output.exists():raise RuntimeError('Codex could not complete this request. Check host CLI sign-in, account limits and model access.')
                        if output.stat().st_size>2*1024*1024:raise ValueError()
                        answer=output.read_text();json.loads(answer)
                        if job['expiresAt']>=time.time():self.write(response,{'output':answer})
                except RuntimeError as e:self.write(response,{'error':str(e),'errorCode':'deadline' if 'exceeded its configured deadline' in str(e) else 'cancelled' if str(e)=='Codex request cancelled.' else 'codex-failed'})
                except (OSError,ValueError,KeyError,TypeError):self.write(response,{'error':'The Codex request could not be processed.'})
                finally:
                    path.unlink(missing_ok=True)
                    cancel.unlink(missing_ok=True);progress.unlink(missing_ok=True)
                    self.process=None
            # Expired response material is never retained indefinitely after a caller exits.
            for path in self.root.glob('*.response.json'):
                try:
                    if time.time()-path.stat().st_mtime>360:path.unlink()
                except OSError:pass
            for marker in self.root.glob('*.cancel.json'):
                try:
                    if json.loads(marker.read_text()).get('expiresAt',0)<time.time():marker.unlink()
                except (OSError,ValueError):pass
            self.stop.wait(0.25)
    def close(self):
        self.stop.set()
        if self.process and self.process.poll() is None:
            try:os.killpg(self.process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        self.thread.join(timeout=3);(self.root/'status.json').unlink(missing_ok=True)
