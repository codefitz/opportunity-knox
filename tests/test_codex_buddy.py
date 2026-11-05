import importlib.util,json,os,sys,tempfile,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('codex_bridge',Path(__file__).resolve().parents[1]/'scripts/codex_buddy.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class CodexBridgeTests(unittest.TestCase):
 def test_safe_flags_and_default_model(self):
  args=bridge.command('codex','/tmp/test','schema','output','default');self.assertIn('--ignore-user-config',args);self.assertIn('--ephemeral',args);self.assertIn('read-only',args);self.assertIn('features.shell_tool=false',args);self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',args);self.assertNotIn('-m',args);self.assertIn('--json',args);self.assertIn('model_reasoning_effort="low"',bridge.command('codex','/tmp/test','schema','output','default','low'))
 def test_worker_fake_cli_and_cleanup(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-codex';fake.write_text('#!'+sys.executable+'\nimport sys,pathlib\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\nprint(\'{"type":"turn.started"}\',flush=True)\nprint(\'{"type":"item.completed","item":{"type":"reasoning","text":"PRIVATE FICTIONAL TEXT"}}\',flush=True)\nprint(\'{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}}\',flush=True)\npathlib.Path(sys.argv[sys.argv.index("-o")+1]).write_text(\'{"ready":true}\')\n');fake.chmod(0o700)
   worker=bridge.CodexWorker(p,str(fake))
   try:
    root=p/'codex-buddy';request=root/'11111111-1111-4111-8111-111111111111.request.json';response=root/request.name.replace('.request.json','.response.json')
    request.write_text(json.dumps({'prompt':'Fictional only','schema':{'type':'object'},'model':'default','expiresAt':time.time()+30}))
    for _ in range(100):
     if response.exists():break
     time.sleep(.05)
    self.assertTrue(response.exists());self.assertEqual(json.loads(json.loads(response.read_text())['output']),{'ready':True});self.assertFalse(request.exists());self.assertNotIn('PRIVATE FICTIONAL TEXT',response.read_text());self.assertEqual(json.loads(response.read_text())['usage']['input_tokens'],12);self.assertGreaterEqual(json.loads(response.read_text())['timings']['executionMs'],0)
   finally:worker.close()
   self.assertFalse((root/'status.json').exists())
 def test_model_catalogue_is_filtered_and_deduplicated(self):
  result=bridge.normalize_models({'models':[{'slug':'fictional-a','display_name':'Fictional A','visibility':'list','base_instructions':'Do not copy instructions'},{'slug':'private-model','visibility':'hide'},{'slug':'fictional-a','visibility':'list'},{'slug':'--bad','visibility':'list'}]})
  self.assertEqual(result['models'],[{'id':'default','name':'Codex default model'},{'id':'fictional-a','name':'Fictional A'}]);self.assertNotIn('base_instructions',str(result));self.assertFalse(result['truncated'])
 def test_cancellation_kills_only_the_owned_cli_process(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-slow-codex';fake.write_text('#!'+sys.executable+'\nimport sys,time\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\ntime.sleep(30)\n');fake.chmod(0o700);worker=bridge.CodexWorker(p,str(fake));root=p/'codex-buddy';jobid='22222222-2222-4222-8222-222222222222'
   try:
    (root/(jobid+'.request.json')).write_text(json.dumps({'prompt':'Fictional slow test','schema':{'type':'object'},'model':'default','expiresAt':time.time()+60}))
    for _ in range(100):
     if (root/(jobid+'.progress.json')).exists():break
     time.sleep(.05)
    process=worker.process;self.assertIsNotNone(process)
    (root/(jobid+'.cancel.json')).write_text(json.dumps({'expiresAt':time.time()+60}))
    for _ in range(100):
     if process.poll() is not None:break
     time.sleep(.05)
    self.assertIsNotNone(process.poll());self.assertNotEqual(process.returncode,0)
    response=root/(jobid+'.response.json')
    for _ in range(100):
     if response.exists():break
     time.sleep(.01)
     self.assertEqual(json.loads(response.read_text())['errorCode'],'cancelled')
   finally:worker.close()
 def test_document_generation_command_flags(self):
  args=bridge.command('codex','/tmp/workspace','schema.json','manifest.json','default',kind='document-generation',images=['/tmp/p1.png','/tmp/p2.png'])
  self.assertIn('workspace-write',args)
  self.assertNotIn('features.shell_tool=false',args)
  self.assertIn('-i',args)
  self.assertIn('/tmp/p1.png',args)
  self.assertIn('/tmp/p2.png',args)
  self.assertIn('-C',args)
  self.assertIn('/tmp/workspace',args)
 def test_document_generation_worker_and_validation(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-doc-codex'
   fake.write_text('#!'+sys.executable+'\nimport sys,pathlib\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\nc_idx=sys.argv.index("-C")+1\nws=pathlib.Path(sys.argv[c_idx])\n(ws/"output.docx").write_bytes(b"PK\\x03\\x04fictional-docx")\nout_idx=sys.argv.index("-o")+1\nmanifest_path=pathlib.Path(sys.argv[out_idx])\nmanifest_path.write_text(\'{"outputDocx":"output.docx","pageCount":2}\')\n');fake.chmod(0o700)
   worker=bridge.CodexWorker(p,str(fake));root=p/'codex-buddy';jobid='33333333-3333-4333-8333-333333333333'
   try:
    job_dir=root/(jobid+'.job');(job_dir/'workspace').mkdir(parents=True,exist_ok=True);(job_dir/'inputs').mkdir(parents=True,exist_ok=True)
    req_file=root/(jobid+'.request.json');resp_file=root/(jobid+'.response.json')
    req_file.write_text(json.dumps({'id':jobid,'kind':'document-generation','jobDir':str(job_dir),'prompt':'Generate CV','schema':{'type':'object'},'model':'default','expiresAt':time.time()+30}))
    for _ in range(100):
     if resp_file.exists():break
     time.sleep(.05)
    self.assertTrue(resp_file.exists())
    data=json.loads(resp_file.read_text())
    self.assertIn('output',data)
    manifest=json.loads(data['output'])
    self.assertEqual(manifest['outputDocx'],'output.docx')
    self.assertEqual(manifest['pageCount'],2)
    self.assertTrue((job_dir/'workspace'/'output.docx').exists())
   finally:worker.close()
 def test_document_generation_workspace_prefix_fallback(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-prefix-codex'
   fake.write_text('#!'+sys.executable+'\nimport sys,pathlib\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\nc_idx=sys.argv.index("-C")+1\nws=pathlib.Path(sys.argv[c_idx])\n(ws/"output.docx").write_bytes(b"PK\\x03\\x04fictional-docx")\nout_idx=sys.argv.index("-o")+1\nmanifest_path=pathlib.Path(sys.argv[out_idx])\nmanifest_path.write_text(\'{"outputDocx":"workspace/output.docx","pageCount":1}\')\n');fake.chmod(0o700)
   worker=bridge.CodexWorker(p,str(fake));root=p/'codex-buddy';jobid='44444444-4444-4444-4444-444444444444'
   try:
    job_dir=root/(jobid+'.job');(job_dir/'workspace').mkdir(parents=True,exist_ok=True)
    req_file=root/(jobid+'.request.json');resp_file=root/(jobid+'.response.json')
    req_file.write_text(json.dumps({'id':jobid,'kind':'document-generation','jobDir':str(job_dir),'prompt':'Generate CV','schema':{'type':'object'},'model':'default','expiresAt':time.time()+30}))
    for _ in range(100):
     if resp_file.exists():break
     time.sleep(.05)
    self.assertTrue(resp_file.exists())
    data=json.loads(resp_file.read_text())
    self.assertNotIn('error',data)
    self.assertIn('output',data)
   finally:worker.close()
 def test_document_generation_detailed_error_reporting(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-err-codex'
   fake.write_text('#!'+sys.executable+'\nimport sys\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\nprint(\'{"type":"error","message":"{\\\\"type\\\\":\\\\"error\\\\",\\\\"error\\\\":{\\\\"message\\\\":\\\\"Invalid schema for response_format\\\\"}}"}\',flush=True)\nsys.exit(1)\n');fake.chmod(0o700)
   worker=bridge.CodexWorker(p,str(fake));root=p/'codex-buddy';jobid='55555555-5555-5555-5555-555555555555'
   try:
    job_dir=root/(jobid+'.job');(job_dir/'workspace').mkdir(parents=True,exist_ok=True)
    req_file=root/(jobid+'.request.json');resp_file=root/(jobid+'.response.json')
    req_file.write_text(json.dumps({'id':jobid,'kind':'document-generation','jobDir':str(job_dir),'prompt':'Generate CV','schema':{'type':'object'},'model':'default','expiresAt':time.time()+30}))
    for _ in range(100):
     if resp_file.exists():break
     time.sleep(.05)
    self.assertTrue(resp_file.exists())
    data=json.loads(resp_file.read_text())
    self.assertIn('error',data)
    self.assertIn('Codex rejected the document schema',data['error'])
    self.assertIn('Invalid schema for response_format',data['error'])
   finally:worker.close()
