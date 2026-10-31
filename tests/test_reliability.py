import importlib.util,json,sqlite3,tempfile,unittest,uuid,hashlib,shutil
from pathlib import Path
spec=importlib.util.spec_from_file_location('host_reliability',Path(__file__).resolve().parents[1]/'scripts/reliability.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ReliabilityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();self.state=self.root/'state';self.files=self.root/'originals';self.dest=self.root/'new folder';self.state.mkdir();self.files.mkdir();self.dest.mkdir();self.config={'files':str(self.files),'roots':[str(self.files)],'port':4318,'bind':'127.0.0.1','vaultReadOnly':True};r.write(self.state/'launcher.json',self.config);r.write(self.state/'runtime.compose.json',{'original':True});self.id=str(uuid.uuid4());self.path=self.files/'opportunities'/self.id;self.path.parent.mkdir();self.path.write_bytes(b'Fictional original');self.doc={'id':self.id,'storageRoot':r.mount(self.files),'relativePath':'opportunities/'+self.id,'sha256':r.digest(self.path),'status':'submitted','revision':1,'name':'Fictional CV.txt'}
  db=r.connection(self.state)
  for table,key in [('config','key'),('documents','id'),('records','id'),('tasks','id'),('buddy_messages','id'),('document_text','id')]:db.execute(f'CREATE TABLE {table}({key} TEXT PRIMARY KEY,data TEXT NOT NULL)')
  db.execute('INSERT INTO documents VALUES(?,?)',(self.id,json.dumps(self.doc)));db.execute('INSERT INTO records VALUES(?,?)',('fictional',json.dumps({'id':'fictional','role':'Original role'})));db.commit();db.close();self.starts=[];self.stops=0
 def tearDown(self):self.temp.cleanup()
 def stop(self):self.stops+=1
 def start(self,c):self.starts.append(c);r.write(self.state/'launcher.json',c);r.write(self.state/'runtime.compose.json',{'files':c['files']})
 def plan(self,kind='migrate',**extra):
  request={'action':'preview','kind':kind,'destination':str(self.dest),'requestId':str(uuid.uuid4()),**extra};r.preview(self.state,self.config,request);return r.read(self.state/'maintenance'/('plan-'+request['requestId']+'.json'))
 def test_idle_accepts_null_optional_jobs_but_blocks_active_work(self):
  db=r.connection(self.state)
  db.executemany('INSERT INTO config VALUES(?,?)', [('vectorIndexJob','null'),('feedbackInbox','null')]);db.commit();db.close()
  r.idle(self.state)
  for status in ('running','cancelling'):
   db=r.connection(self.state);db.execute('UPDATE config SET data=? WHERE key=?',(json.dumps({'status':status}),'vectorIndexJob'));db.commit();db.close()
   with self.assertRaisesRegex(ValueError,'Stop library indexing first'):r.idle(self.state)
  db=r.connection(self.state);db.execute('UPDATE config SET data=? WHERE key=?',('null','vectorIndexJob'));db.execute('UPDATE config SET data=? WHERE key=?',(json.dumps({'items':[{'reviewStatus':'running'}]}),'feedbackInbox'));db.commit();db.close()
  with self.assertRaisesRegex(ValueError,'Finish feedback reviews first'):r.idle(self.state)
 def test_copy_verifies_originals_submitted_versions_and_retains_portable_backup(self):
  plan=self.plan();result=r.install(self.state,self.config,plan,self.stop,self.start);db=r.connection(self.state);doc=r.documents(db)[0];db.close();new=self.starts[-1];self.assertEqual(self.path.read_bytes(),b'Fictional original');self.assertEqual(doc['status'],'submitted');self.assertEqual(doc['id'],self.id);self.assertEqual(doc['revision'],2);self.assertEqual(r.resolve_document(doc,new).read_bytes(),b'Fictional original');self.assertTrue((Path(new['files'])/'backups'/result['backup']/'board.sqlite').exists());self.assertEqual(r.read(self.state/'maintenance'/'transaction.json')['state'],'committed')
 def test_changed_inputs_are_rejected_before_stopping(self):
  plan=self.plan();self.path.write_bytes(b'Changed');self.assertRaises(ValueError,r.install,self.state,self.config,plan,self.stop,self.start);self.assertEqual(self.stops,0)
 def test_restart_failure_restores_original_database_and_mount_configuration(self):
  plan=self.plan()
  def start(c):
   if not self.starts:self.starts.append(c);raise RuntimeError('Fictional restart failure')
   self.start(c)
  self.assertRaises(RuntimeError,r.install,self.state,self.config,plan,self.stop,start);db=r.connection(self.state);self.assertEqual(r.documents(db)[0],self.doc);db.close();self.assertEqual(r.read(self.state/'launcher.json'),self.config);self.assertEqual(self.path.read_bytes(),b'Fictional original')
 def test_relink_recovers_unavailable_root_without_rewriting_candidate_bytes(self):
  relative=Path(self.doc['relativePath']);(self.dest/relative).parent.mkdir();shutil.copyfile(self.path,self.dest/relative);shutil.rmtree(self.files);plan=self.plan('relink');result=r.install(self.state,self.config,plan,self.stop,self.start);self.assertEqual((self.dest/relative).read_bytes(),b'Fictional original');db=r.connection(self.state);self.assertEqual(r.documents(db)[0]['storageRoot'],r.mount(self.dest));db.close();self.assertEqual(result['documents'],1)
 def test_restore_activation_uses_verified_isolated_copy_and_keeps_current_workspace_backup(self):
  restore_id='restore-'+str(uuid.uuid4());root=self.state/'restores'/restore_id;(root/'state').mkdir(parents=True);(root/'files').mkdir();db=r.connection(self.state);dest=sqlite3.connect(root/'state'/'board.sqlite');db.backup(dest);db.close();dest.execute('UPDATE records SET data=?',(json.dumps({'id':'fictional','role':'Restored role'}),));doc={**self.doc,'relativePath':self.id};dest.execute('UPDATE documents SET data=?',(json.dumps(doc),));dest.commit();dest.close();(root/'files'/self.id).write_bytes(b'Fictional original');r.write(root/'restore-report.json',{'validated':True});plan=self.plan('restore',restoreId=restore_id);result=r.install(self.state,self.config,plan,self.stop,self.start);db=r.connection(self.state);self.assertEqual(r.rows(db,'records')[0]['role'],'Restored role');self.assertEqual(r.config_value(db,'sessions'),{});db.close();old=sqlite3.connect(Path(result['backupLocation'])/'board.sqlite');self.assertEqual(r.rows(old,'records')[0]['role'],'Original role');old.close()
 def test_crash_journal_rolls_back_interrupted_database_switch(self):
  backup=r.snapshot(self.state,self.config,self.state/'backup-test');rollback=self.state/'maintenance'/'rollback-test';rollback.mkdir(parents=True);shutil.copyfile(backup/'board.sqlite',rollback/'board.sqlite');r.write(self.state/'maintenance'/'transaction.json',{'state':'switching','rollback':str(rollback),'oldConfig':self.config,'oldRuntime':{'original':True}});db=r.connection(self.state);db.execute('DELETE FROM records');db.commit();db.close();self.assertTrue(r.recover(self.state,self.stop,self.start));db=r.connection(self.state);self.assertEqual(len(r.rows(db,'records')),1);db.close();self.assertEqual(r.read(self.state/'maintenance-status.json')['phase'],'interrupted')
 def test_readonly_destination_and_path_escape_are_refused(self):
  self.config['sourceRoots']=[{'hostPath':str(self.dest)}];self.assertRaises(ValueError,self.plan);self.assertRaises(ValueError,r.relative,'../private');self.assertRaises(ValueError,r.safe_restore,self.state,'../../private')
 def test_readonly_rejection_happens_before_any_write_probe(self):
  from unittest.mock import patch
  self.config['sourceRoots']=[{'hostPath':str(self.dest)}]
  with patch.object(Path,'write_bytes') as write:
   self.assertRaises(ValueError,self.plan)
   write.assert_not_called()
 def test_snapshot_refuses_backup_symlink_into_a_readonly_source(self):
  source=self.root/'readonly';source.mkdir();(self.files/'backups').symlink_to(source,target_is_directory=True)
  self.assertRaises(ValueError,r.snapshot,self.state,self.config)
  self.assertEqual(list(source.iterdir()),[])
 def test_unavailable_readonly_mount_blocks_change_before_stopping(self):
  self.config['sourceRoots']=[{'hostPath':str(self.root/'offline-source')}]
  self.assertRaises(ValueError,self.plan)
  self.assertEqual(self.stops,0)
 def test_changed_record_invalidates_preview_without_discarding_it(self):
  plan=self.plan();db=r.connection(self.state);db.execute('UPDATE records SET data=?',(json.dumps({'id':'fictional','role':'Changed after preview'}),));db.commit();db.close();self.assertRaises(ValueError,r.install,self.state,self.config,plan,self.stop,self.start);self.assertEqual(self.stops,0);db=r.connection(self.state);self.assertEqual(r.rows(db,'records')[0]['role'],'Changed after preview');db.close()
 def test_interrupted_preparation_restarts_original_without_replacing_database(self):
  r.write(self.state/'maintenance'/'transaction.json',{'state':'preparing','oldConfig':self.config,'oldRuntime':{'original':True}});self.assertTrue(r.recover(self.state,self.stop,self.start));db=r.connection(self.state);self.assertEqual(r.rows(db,'records')[0]['role'],'Original role');db.close();self.assertEqual(self.starts[-1],self.config)
