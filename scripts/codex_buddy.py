"""Launcher-owned Codex bridge; no listening port or copied credentials."""
import json, os, re, shutil, signal, subprocess, tempfile, threading, time
from pathlib import Path

def command(executable, directory, schema, output, model, effort=None, kind='inference', images=None):
    sandbox = 'workspace-write' if kind == 'document-generation' else 'read-only'
    args = [executable, 'exec', '--json', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', sandbox, '-C', str(directory), '--output-schema', str(schema), '-o', str(output)]
    features = {
        'features.apps': 'false',
        'features.plugins': 'false',
        'features.memories': 'false',
        'features.request_permissions_tool': 'false',
        'skills.bundled.enabled': 'false',
        'skills.include_instructions': 'false',
        'web_search': '"disabled"',
        'project_doc_max_bytes': '0',
        'approval_policy': '"never"',
    }
    if kind != 'document-generation':
        features['features.shell_tool'] = 'false'
    for key, value in features.items():
        args += ['-c', key + '=' + value]
    if effort in ('low', 'medium', 'high'):
        args += ['-c', 'model_reasoning_effort=' + json.dumps(effort)]
    if model != 'default':
        args += ['-m', model]
    if images:
        for img in images:
            args += ['-i', str(img)]
    return args + ['-']

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
                    is_doc = job.get('kind') == 'document-generation'
                    temp_dir = None
                    if is_doc:
                        req_job_dir = job.get('jobDir', '')
                        job_dir = (self.root / Path(req_job_dir).name).resolve() if req_job_dir else (self.root / f"{job.get('id', '')}.job").resolve()
                        if not job_dir.is_relative_to(self.root.resolve()) or not job_dir.is_dir():
                            raise ValueError('Invalid job directory for document generation')
                        workspace = job_dir / 'workspace'
                        workspace.mkdir(mode=0o700, exist_ok=True)
                        schema = job_dir / 'schema.json'
                        schema.write_text(json.dumps(job['schema']), encoding='utf8')
                        output = job_dir / 'manifest.json'
                        prompt = job_dir / 'prompt.txt'
                        prompt.write_text(job['prompt'], encoding='utf8'); prompt.chmod(0o600)
                        images = [Path(img) for img in job.get('images', []) if Path(img).exists()]
                        run_dir = workspace
                    else:
                        temp_dir = tempfile.TemporaryDirectory(prefix='knox-codex-')
                        temp = Path(temp_dir.name)
                        schema = temp / 'schema.json'; schema.write_text(json.dumps(job['schema'])); output = temp / 'answer.json'
                        prompt = temp / 'prompt.txt'; prompt.write_text(job['prompt']); prompt.chmod(0o600)
                        images = None
                        run_dir = temp
                    try:
                        env = {k: v for k, v in os.environ.items() if k not in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN')}
                        execution_started = time.monotonic()
                        details = {'stage': 'running-codex', 'eventCount': 0}
                        def events(process):
                            while True:
                                line = process.stdout.readline(65537)
                                if not line: break
                                if len(line) > 65536:
                                    while line and not line.endswith('\n'): line = process.stdout.readline(65537)
                                    continue
                                try: event = json.loads(line)
                                except (ValueError, TypeError): continue
                                if not isinstance(event, dict): continue
                                kind = event.get('type')
                                if kind not in ('thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error'): continue
                                details['eventCount'] += 1; details['lastEventAt'] = time.time()
                                if kind in ('error', 'turn.failed'):
                                    details['stage'] = 'codex-error'
                                    message = str(event.get('message', event.get('error', ''))).lower()
                                    details['issue'] = 'rate-limit' if 'rate limit' in message or '429' in message else 'authentication' if '401' in message or 'unauthorized' in message else 'connection' if 'connect' in message or 'stream' in message else 'schema' if 'schema' in message else 'provider-error'
                                elif kind.startswith('item.'):
                                    details['stage'] = 'codex-reasoning' if event.get('item', {}).get('type') == 'reasoning' else 'receiving-response'
                                elif kind == 'turn.started': details['stage'] = 'running-codex'
                                if kind == 'turn.completed':
                                    usage = event.get('usage', {})
                                    details['usage'] = {k: v for k, v in usage.items() if k in ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens') and type(v) is int and v >= 0}
                                self.write(progress, dict(details))
                        cmd = command(self.executable, run_dir, schema, output, model, job.get('reasoningEffort'), kind=job.get('kind', 'inference'), images=images)
                        with prompt.open() as input_file:
                            self.process = subprocess.Popen(cmd, stdin=input_file, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True, env=env)
                        self.write(progress, dict(details))
                        reader = threading.Thread(target=events, args=(self.process,), daemon=True); reader.start()
                        deadline = min(job['expiresAt'], time.time() + 900)
                        while self.process.poll() is None:
                            if cancel.exists() or self.stop.is_set() or time.time() >= deadline:
                                try: os.killpg(self.process.pid, signal.SIGKILL)
                                except ProcessLookupError: pass
                                self.process.wait(); reader.join(timeout=1); self.process.stdout.close()
                                raise RuntimeError('Codex request cancelled.' if cancel.exists() or self.stop.is_set() else 'Codex request exceeded its configured deadline.')
                            self.stop.wait(.1)
                        reader.join(timeout=1); self.process.stdout.close()
                        if is_doc:
                            if self.process.returncode or not output.exists():
                                raise RuntimeError('Codex could not complete document generation. Check host CLI sign-in, account limits and model access.')
                            if output.stat().st_size > 2 * 1024 * 1024: raise ValueError()
                            manifest_raw = output.read_text(encoding='utf8')
                            manifest = json.loads(manifest_raw)
                            out_docx_rel = manifest.get('outputDocx')
                            if not isinstance(out_docx_rel, str) or not out_docx_rel or '..' in out_docx_rel or out_docx_rel.startswith('/'):
                                raise ValueError('Invalid outputDocx in manifest')
                            target_docx = (workspace / out_docx_rel).resolve()
                            if not target_docx.is_relative_to(workspace.resolve()) or not target_docx.is_file():
                                raise ValueError('outputDocx missing from workspace')
                            if target_docx.stat().st_size > 20 * 1024 * 1024:
                                raise ValueError('outputDocx exceeds size limit')
                            if job['expiresAt'] >= time.time():
                                self.write(response, {'output': manifest_raw, 'timings': {'executionMs': round((time.monotonic() - execution_started) * 1000)}, 'usage': details.get('usage', {})})
                        else:
                            if self.process.returncode or not output.exists():
                                raise RuntimeError('Codex could not complete this request. Check host CLI sign-in, account limits and model access.')
                            if output.stat().st_size > 2 * 1024 * 1024: raise ValueError()
                            answer = output.read_text(); json.loads(answer)
                            if job['expiresAt'] >= time.time():
                                self.write(response, {'output': answer, 'timings': {'executionMs': round((time.monotonic() - execution_started) * 1000)}, 'usage': details.get('usage', {})})
                    finally:
                        if temp_dir: temp_dir.cleanup()
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
            for job_dir in self.root.glob('*.job'):
                try:
                    if time.time() - job_dir.stat().st_mtime > 600:
                        shutil.rmtree(job_dir, ignore_errors=True)
                except OSError: pass
            self.stop.wait(0.25)
    def close(self):
        self.stop.set()
        if self.process and self.process.poll() is None:
            try:os.killpg(self.process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        self.thread.join(timeout=3);(self.root/'status.json').unlink(missing_ok=True)
