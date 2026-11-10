import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { runInNewContext } from "node:vm";
import { antigravityCallbackExtension, compileAntigravityBrowserLauncher, createAntigravityLoginRelay, signInToAntigravityBrowser } from "./antigravity-browser-login.ts";

const STATE = "momp-synthetic-state-not-a-credential";
const CALLBACK = "https://antigravity.google/oauth-callback";
const authUrl = (state = STATE) => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({state,redirect_uri:CALLBACK,response_type:"code",code_challenge:"synthetic-challenge",code_challenge_method:"S256"})) url.searchParams.set(key, value);
  return url.href;
};
const callbackUrl = (code = "4/synthetic-code", state = STATE) => {
  const url = new URL(CALLBACK);
  url.searchParams.set("state", state); url.searchParams.set("code", code);
  return url.href;
};
async function post(relay, path, body, headers = {}) {
  return fetch(relay.origin + path, {method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer " + relay.token,...headers},body:JSON.stringify(body)});
}

async function relayFixture(t, overrides = {}) {
  const opened = [], codes = [], errors = [];
  const relay = await createAntigravityLoginRelay({onOpen:async url=>{opened.push(url);},onCode:async code=>{codes.push(code);},onReady:()=>{},onError:error=>errors.push(error.kind),...overrides});
  t.after(()=>relay.close());
  return {relay,opened,codes,errors};
}

test("Google callback relay validates nonce, origin and official OAuth parameters before opening", async t => {
  const {relay,opened,codes} = await relayFixture(t);
  assert.equal((await post(relay,"/open",{url:authUrl()},{Authorization:"Bearer wrong"})).status,403);
  assert.equal((await post(relay,"/open",{url:authUrl()},{Origin:"https://evil.example"})).status,403);
  for(const value of ["https://accounts.google.com.example/?state=x",authUrl().replace(encodeURIComponent(CALLBACK),encodeURIComponent("http://127.0.0.1:7000/callback")),authUrl().replace("S256","plain"),authUrl()+"&state=duplicate"]){
    assert.equal((await post(relay,"/open",{url:value})).status,400);
  }
  assert.deepEqual(opened,[]); assert.deepEqual(codes,[]);
  assert.equal((await post(relay,"/open",{url:authUrl()})).status,204);
  assert.equal((await post(relay,"/open",{url:authUrl()})).status,409);
  assert.deepEqual(opened,[authUrl()]);
});

test("Google callback relay requires extension readiness, matching state and a single-use code", async t => {
  const {relay,codes} = await relayFixture(t);
  assert.equal((await post(relay,"/open",{url:authUrl()})).status,204);
  assert.equal((await post(relay,"/callback",{url:callbackUrl()})).status,409);
  assert.equal((await post(relay,"/ready",{},{Origin:"https://antigravity.google"})).status,403);
  const denied=await post(relay,"/ready",{},{Authorization:"Bearer wrong"});
  assert.equal(denied.status,403); assert.equal((await denied.text()).includes(STATE),false);
  const navigation=await post(relay,"/ready",{},{Origin:"chrome-extension://"+"a".repeat(32)});
  assert.equal(navigation.status,200); assert.deepEqual(await navigation.json(),{url:authUrl()});
  const duplicate=await post(relay,"/ready",{});
  assert.equal(duplicate.status,409); assert.equal((await duplicate.text()).includes(STATE),false);
  for(const value of [callbackUrl().replace("antigravity.google/","antigravity.google.example/"),callbackUrl("fake","wrong-state"),callbackUrl()+"&state=duplicate",callbackUrl()+"#fragment"]){
    assert.equal((await post(relay,"/callback",{url:value})).status,403);
  }
  for(const code of ["bad\ncode","bad\u0000code","bad code","x".repeat(8193)]) assert.equal((await post(relay,"/callback",{url:callbackUrl(code)})).status,400);
  assert.equal((await post(relay,"/callback",{url:callbackUrl()+"&code=duplicate"})).status,400);
  assert.deepEqual(codes,[]);
  assert.equal((await post(relay,"/callback",{url:callbackUrl()})).status,204);
  assert.deepEqual(codes,["4/synthetic-code"]);
  assert.equal((await post(relay,"/callback",{url:callbackUrl("second")})).status,409);
  assert.deepEqual(codes,["4/synthetic-code"]);
});

test("Google callback relay expires and reports declined consent without passing a code", async t => {
  const {relay,codes,errors} = await relayFixture(t);
  await post(relay,"/open",{url:authUrl()}); await post(relay,"/ready",{});
  assert.equal((await post(relay,"/callback",{url:CALLBACK+"?state="+STATE+"&error=access_denied"})).status,204);
  assert.deepEqual(errors,["cancelled"]); assert.deepEqual(codes,[]);
  let expire;
  const expired = new Promise(resolve => {expire=resolve;});
  const brief = await relayFixture(t,{ttlMs:15,onError:expire});
  assert.equal((await expired).kind,"timeout");
  assert.equal((await post(brief.relay,"/open",{url:authUrl()})).status,410);
});

test("callback extension observes only the official main-frame return and sends a protected local request", async () => {
  const token="a".repeat(43),origin="http://127.0.0.1:30123";
  const extension=antigravityCallbackExtension(origin,token);
  assert.deepEqual(extension.manifest.permissions,["webRequest"]);
  assert.deepEqual(extension.manifest.host_permissions,["https://antigravity.google/*","http://127.0.0.1/*"]);
  let callback, filter; const sent=[],navigated=[],order=[];
  runInNewContext(extension.worker,{URL,fetch:async (url,options)=>{order.push("ready-request");sent.push({url,options});return {ok:true,json:async()=>({url:authUrl()})};},chrome:{tabs:{create:async options=>{order.push("navigate");navigated.push(options.url);}},webRequest:{onBeforeRequest:{addListener:(fn,filters)=>{order.push("listener");callback=fn;filter=filters;}}}}});
  assert.equal(JSON.stringify(filter),JSON.stringify({urls:[CALLBACK+"*"],types:["main_frame"]}));
  for(const details of [
    {type:"sub_frame",frameId:1,url:callbackUrl()},
    {type:"main_frame",frameId:0,url:"https://accounts.google.com/?code=private"},
    {type:"main_frame",frameId:0,url:"https://antigravity.google/oauth-callback-other?code=private"},
  ]) callback(details);
  callback({type:"main_frame",frameId:0,url:callbackUrl()});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(sent.length,2);
  assert.deepEqual(navigated,[authUrl()]);
  assert.deepEqual(order.slice(0,3),["listener","ready-request","navigate"]);
  assert.equal(sent[0].url,origin+"/ready");
  assert.equal(sent[1].url,origin+"/callback");
  assert.equal(sent[1].options.headers.Authorization,"Bearer "+token);
  assert.deepEqual(JSON.parse(sent[1].options.body),{url:callbackUrl()});
  assert.throws(()=>antigravityCallbackExtension("http://localhost:30123",token));
  assert.throws(()=>antigravityCallbackExtension(origin,"bad-token"));
});

async function loginFixture(t, overrides = {}) {
  const root=await mkdtemp(join(tmpdir(),"momp-login-test-"));
  const executable=join(root,"bun-fixture.exe"); await writeFile(executable,"synthetic executable fixture");
  t.after(()=>rm(root,{recursive:true,force:true}));
  let readyFixture;
  const available=new Promise(resolve=>{readyFixture=resolve;});
  const fixture={root,browserClosed:0,terminated:0,writes:[],opened:[],cwd:undefined,native:undefined,relay:undefined,navigated:false};
  const pending=signInToAntigravityBrowser("official-agy.exe",overrides.signal,{
    platform:"win32",temporaryRoot:root,bunExecutable:executable,
    env:{PATH:"original-os-path",SystemRoot:"C:\\Windows",HOME:root,OPENAI_API_KEY:"secret",GEMINI_API_KEY:"secret",SSH_CONNECTION:"secret",HTTP_PROXY:"http://127.0.0.1:30001"},
    networkEnv:env=>env,timeoutMs:2000,handshakeTimeoutMs:500,
    compileLauncher:async ({cwd})=>{await writeFile(join(cwd,"browser-launcher","rundll32.exe"),"compiled GUI fixture");},
    createBrowser:async ({extensionDirectory,beforeNavigate,extensionNavigates,onClose})=>{
      fixture.closeBrowserWindow=onClose;
      assert.equal(extensionNavigates,true);
      const worker=await readFile(join(extensionDirectory,"background.js"),"utf8");
      fixture.relay={origin:JSON.parse(worker.match(/const origin = ("[^"]+");/)[1]),token:JSON.parse(worker.match(/const token = ("[^"]+");/)[1])};
      return {open:async url=>{fixture.opened.push(url);if(overrides.awaitBeforeNavigate)await beforeNavigate();fixture.navigated=true;},close:async()=>{fixture.browserClosed++;}};
    },
    spawn:(_exe,args,options)=>{
      fixture.cwd=options.cwd;fixture.args=args;fixture.env=options.env;
      const native=new EventEmitter();
      native.stdin=new PassThrough();native.stdout=new PassThrough();native.stderr=new PassThrough();
      native.pid=123456;native.exitCode=null;native.signalCode=null;
      native.stdin.on("data",data=>fixture.writes.push(data.toString()));
      native.stdin.on("finish",()=>{if(!overrides.holdExit){native.exitCode=0;native.emit("exit",0);}});
      fixture.native=native;
      queueMicrotask(()=>readyFixture(fixture));
      return native;
    },
    terminate:async native=>{fixture.terminated++;native.exitCode=1;native.emit("exit",1);},
    ...overrides.dependencies,
  });
  void pending.catch(()=>{});
  return {fixture:await available,pending};
}

test("native login sends only the returned code and waits for official init plus clean exit", async t => {
  const {fixture:f,pending}=await loginFixture(t);
  assert.deepEqual(f.args,["--input-format","stream-json","--output-format","stream-json","--sandbox","--settings",'{"modelProvider":""}']);
  const sessionSettings=JSON.parse(f.args[f.args.indexOf("--settings")+1]);
  assert.deepEqual(sessionSettings,{modelProvider:""},"Account sign-in must override an inherited API-key provider for this invocation only");
  assert.equal(f.env.OPENAI_API_KEY,undefined);assert.equal(f.env.GEMINI_API_KEY,undefined);assert.equal(f.env.SSH_CONNECTION,undefined);
  assert.equal(f.env.HTTP_PROXY,"http://127.0.0.1:30001");
  assert.equal(f.env.PATH.split(delimiter)[0],join(f.cwd,"browser-launcher"));
  let settled=false; void pending.then(()=>{settled=true;});
  await post(f.relay,"/open",{url:authUrl()}); await post(f.relay,"/ready",{});
  await post(f.relay,"/callback",{url:callbackUrl()});
  assert.deepEqual(f.writes,["4/synthetic-code\n"]);
  await new Promise(resolve=>setTimeout(resolve,0)); assert.equal(settled,false);
  f.native.stdout.write('{"type":"system","subtype":"init"}\n');
  await new Promise(resolve=>setTimeout(resolve,0)); assert.equal(settled,false);
  const event=JSON.stringify({event:"init",conversation_id:"synthetic",init:{cwd:f.cwd}})+"\n";
  f.native.stdout.write(event.slice(0,8));f.native.stdout.write(event.slice(8));
  await pending;
  assert.equal(f.browserClosed,1);
  assert.deepEqual(f.writes,["4/synthetic-code\n"]);
  assert.deepEqual(await readdir(f.root),["bun-fixture.exe"]);
});

test("native sign-in accepts a cached official init without starting a browser or sending a task", async t => {
  const {fixture:f,pending}=await loginFixture(t);
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"cached",init:{cwd:f.cwd}})+"\n");
  await pending;assert.deepEqual(f.opened,[]);assert.deepEqual(f.writes,[]);assert.equal(f.browserClosed,1);
});

test("native sign-in abort, early exit, oversized output and missing extension fail closed and clean up", async t => {
  for(const scenario of ["abort","exit","oversize","handshake","timeout"]){
    const controller=new AbortController();
    const {fixture:f,pending}=await loginFixture(t,{signal:controller.signal,dependencies:{handshakeTimeoutMs:15}});
    if(scenario==="abort") controller.abort();
    if(scenario==="exit"){f.native.exitCode=0;f.native.emit("exit",0);}
    if(scenario==="oversize") f.native.stdout.write("x".repeat(1_048_577));
    if(scenario==="handshake") await post(f.relay,"/open",{url:authUrl()});
    if(scenario==="timeout") f.native.stdout.write(JSON.stringify({event:"result",result:{status:"ERROR",error:"authentication failed or timed out"}})+"\n");
    await assert.rejects(pending,error=>error.kind===({abort:"cancelled",exit:"unavailable",oversize:"unavailable",handshake:"xbox-dns-browser",timeout:"timeout"}[scenario]));
    assert.deepEqual(f.writes,[]);assert.equal(f.browserClosed,1);assert.equal(f.terminated,1);
    assert.deepEqual(await readdir(f.root),["bun-fixture.exe"]);
  }
});
test("cancelling after init but before native exit cannot report successful login", async t => {
  const controller=new AbortController();
  const {fixture:f,pending}=await loginFixture(t,{signal:controller.signal,holdExit:true});
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"cached",init:{cwd:f.cwd}})+"\n");
  await new Promise(resolve=>setTimeout(resolve,0));
  controller.abort();
  f.native.exitCode=0;f.native.emit("exit",0);
  await assert.rejects(pending,error=>error.kind==="cancelled");
  assert.equal(f.browserClosed,1);assert.deepEqual(f.writes,[]);
});
test("native launcher receives acknowledgement before browser readiness without reporting login success", async t => {
  const {fixture:f,pending}=await loginFixture(t,{awaitBeforeNavigate:true});
  let settled=false; void pending.then(()=>{settled=true;});
  assert.equal((await post(f.relay,"/open",{url:authUrl()})).status,204);
  assert.equal(f.navigated,false);
  assert.equal(settled,false);
  assert.equal((await post(f.relay,"/ready",{})).status,200);
  while(!f.navigated)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(settled,false);
  assert.deepEqual(f.writes,[]);
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"ready",init:{cwd:f.cwd}})+"\n");
  await pending; assert.equal(f.browserClosed,1);
});

test("relay reports browser startup failure after acknowledging the native launch", async t => {
  let rejectStartup;
  const startup=new Promise((_resolve,reject)=>{rejectStartup=reject;});
  let reportError;
  const failed=new Promise(resolve=>{reportError=resolve;});
  const {relay}=await relayFixture(t,{onOpen:()=>startup,onError:reportError});
  assert.equal((await post(relay,"/open",{url:authUrl()})).status,204);
  assert.equal((await post(relay,"/open",{url:authUrl()})).status,409);
  rejectStartup(new Error("private native diagnostic must not escape"));
  const error=await failed;
  assert.equal(error.kind,"xbox-dns-browser");
  assert.equal(error.message.includes("private native"),false);
});

test("callback extension refuses non-Google and credential-bearing navigation URLs", async () => {
  for(const value of ["http://accounts.google.com/", "https://accounts.google.com.example/", "https://user@accounts.google.com/", "https://accounts.google.com:8443/", "javascript:alert(1)", null]){
    const navigated=[];
    const extension=antigravityCallbackExtension("http://127.0.0.1:30123","a".repeat(43));
    runInNewContext(extension.worker,{URL,fetch:async()=>({ok:true,json:async()=>({url:value})}),chrome:{tabs:{create:async options=>navigated.push(options)},webRequest:{onBeforeRequest:{addListener:()=>{}}}}});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(navigated,[]);
  }
});

test("native failure after init cannot be hidden by clean exit", async t => {
  const {fixture:f,pending}=await loginFixture(t,{holdExit:true});
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"cached",init:{cwd:f.cwd}})+"\n");
  await new Promise(resolve=>setTimeout(resolve,0));
  f.native.stdout.write(JSON.stringify({event:"result",result:{status:"ERROR",error:"synthetic provider failure"}})+"\n");
  f.native.exitCode=0;f.native.emit("exit",0);
  await assert.rejects(pending,error=>error.kind==="unavailable");
  assert.equal(f.browserClosed,1);assert.deepEqual(f.writes,[]);
});

test("native successful terminal result after init is compatible with clean EOF", async t => {
  const {fixture:f,pending}=await loginFixture(t,{holdExit:true});
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"cached",init:{cwd:f.cwd}})+"\n");
  await new Promise(resolve=>setTimeout(resolve,0));
  f.native.stdout.write(JSON.stringify({event:"result",result:{status:"SUCCESS"}})+"\n");
  f.native.exitCode=0;f.native.emit("exit",0);
  await pending;
  assert.equal(f.browserClosed,1);assert.deepEqual(f.writes,[]);
});

test("closing the Google browser cancels login and releases native resources for retry", async t => {
  const {fixture:f,pending}=await loginFixture(t);
  await post(f.relay,"/open",{url:authUrl()});
  await post(f.relay,"/ready",{});
  f.closeBrowserWindow();
  await assert.rejects(pending,error=>error.kind==="cancelled");
  assert.equal(f.browserClosed,1);assert.equal(f.terminated,1);assert.deepEqual(f.writes,[]);
  assert.deepEqual(await readdir(f.root),["bun-fixture.exe"]);
});

test("Windows bundled Bun compiles a GUI launcher that delivers the native browser-open contract offline", {skip:process.platform!=="win32",timeout:60_000}, async t => {
  const controller=new AbortController();
  t.after(()=>controller.abort());
  const {fixture:f,pending}=await loginFixture(t,{signal:controller.signal,dependencies:{
    bunExecutable:process.execPath,compileLauncher:compileAntigravityBrowserLauncher,timeoutMs:55_000,handshakeTimeoutMs:15_000,
  }});
  const executable=join(f.cwd,"browser-launcher","rundll32.exe");
  const file=await open(executable,"r");
  try {
    const dos=Buffer.alloc(64);assert.equal((await file.read(dos,0,64,0)).bytesRead,64);
    assert.equal(dos.readUInt16LE(0),0x5a4d);
    const pe=Buffer.alloc(96);assert.equal((await file.read(pe,0,96,dos.readUInt32LE(60))).bytesRead,96);
    assert.equal(pe.readUInt32LE(0),0x00004550);
    assert.equal(pe.readUInt16LE(92),2,"Compiled launcher must use the Windows GUI subsystem");
  } finally {await file.close();}
  await new Promise((resolve,reject)=>execFile(executable,["url.dll,FileProtocolHandler",authUrl()],{
    cwd:f.root,windowsHide:true,timeout:10_000,signal:controller.signal,
  },error=>error?reject(error):resolve()));
  assert.deepEqual(f.opened,[authUrl()]);
  assert.deepEqual(f.writes,[]);
  assert.equal((await post(f.relay,"/ready",{})).status,200);
  assert.equal((await post(f.relay,"/callback",{url:callbackUrl()})).status,204);
  assert.deepEqual(f.writes,["4/synthetic-code\n"]);
  f.native.stdout.write(JSON.stringify({event:"init",conversation_id:"offline-compiler-contract",init:{cwd:f.cwd}})+"\n");
  await pending;
  assert.equal(f.browserClosed,1);
  assert.deepEqual(await readdir(f.root),["bun-fixture.exe"]);
});
