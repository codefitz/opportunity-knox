import importlib.util,json,os,sys,tempfile,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('codex_bridge',Path(__file__).resolve().parents[1]/'scripts/codex_buddy.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class CodexBridgeTests(unittest.TestCase):
 def test_safe_flags_and_default_model(self):
  args=bridge.command('codex','/tmp/test','schema','output','default');self.assertIn('--ignore-user-config',args);self.assertIn('--ephemeral',args);self.assertIn('read-only',args);self.assertIn('features.shell_tool=false',args);self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',args);self.assertNotIn('-m',args)
 def test_worker_fake_cli_and_cleanup(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);fake=p/'fake-codex';fake.write_text('#!'+sys.executable+'\nimport sys,pathlib\nif sys.argv[1:]==["login","status"]:print("Logged in using ChatGPT");sys.exit(0)\nsys.stdin.read()\npathlib.Path(sys.argv[sys.argv.index("-o")+1]).write_text(\'{"ready":true}\')\n');fake.chmod(0o700)
   worker=bridge.CodexWorker(p,str(fake))
   try:
    root=p/'codex-buddy';request=root/'11111111-1111-4111-8111-111111111111.request.json';response=root/request.name.replace('.request.json','.response.json')
    request.write_text(json.dumps({'prompt':'Fictional only','schema':{'type':'object'},'model':'default','expiresAt':time.time()+30}))
    for _ in range(100):
     if response.exists():break
     time.sleep(.05)
    self.assertTrue(response.exists());self.assertEqual(json.loads(json.loads(response.read_text())['output']),{'ready':True});self.assertFalse(request.exists())
   finally:worker.close()
   self.assertFalse((root/'status.json').exists())
 def test_model_catalogue_is_filtered_and_deduplicated(self):
  result=bridge.normalize_models({'models':[{'slug':'fictional-a','display_name':'Fictional A','visibility':'list','base_instructions':'Do not copy instructions'},{'slug':'private-model','visibility':'hide'},{'slug':'fictional-a','visibility':'list'},{'slug':'--bad','visibility':'list'}]})
  self.assertEqual(result['models'],[{'id':'default','name':'Codex default model'},{'id':'fictional-a','name':'Fictional A'}]);self.assertNotIn('base_instructions',str(result));self.assertFalse(result['truncated'])
