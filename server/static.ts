import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

// Safari polyfills — injected server-side so they run BEFORE any module scripts
// This fixes the "a problem repeatedly occurred" crash on iOS Safari
const SAFARI_INJECT = `<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="format-detection" content="telephone=no"><script>(function(){if(typeof globalThis==="undefined"){try{Object.defineProperty(Object.prototype,"__magic__",{get:function(){return this},configurable:true});__magic__.globalThis=__magic__;delete Object.prototype.__magic__;}catch(e){window.globalThis=window;}}if(typeof window.queueMicrotask!=="function"){window.queueMicrotask=function(fn){return Promise.resolve().then(fn).catch(function(e){setTimeout(function(){throw e;},0);});};}if(typeof window.structuredClone==="undefined"){window.structuredClone=function(obj){return JSON.parse(JSON.stringify(obj));};}if(!Element.prototype.replaceChildren){Element.prototype.replaceChildren=function(){this.innerHTML="";for(var i=0;i<arguments.length;i++){this.appendChild(arguments[i] instanceof Node?arguments[i]:document.createTextNode(arguments[i]));}}}if(!Promise.allSettled){Promise.allSettled=function(ps){return Promise.all(ps.map(function(p){return Promise.resolve(p).then(function(v){return{status:"fulfilled",value:v}},function(r){return{status:"rejected",reason:r}});}));};}})();<\/script>`;

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // index: false prevents express.static from serving index.html directly,
  // so ALL html requests fall through to the polyfill-injection handler below
  app.use(express.static(distPath, { index: false }));

  // Serve index.html with Safari polyfills injected at the very start of <head>
  // MUST come after express.static so asset files (js/css) are served directly
  app.use("/{*path}", (_req: Request, res: Response) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    // Inject right after <head> so polyfills run before ANY other scripts
    html = html.replace("<head>", "<head>" + SAFARI_INJECT);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store"); // prevent caching of polyfill-injected HTML
    res.send(html);
  });
}
