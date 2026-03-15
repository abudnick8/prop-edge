import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

// Safari polyfills injected server-side to fix "a problem repeatedly occurred" crash on iOS
const SAFARI_POLYFILL = `<script>
// Polyfill for older Safari
if(typeof globalThis==="undefined"){window.globalThis=window;}
if(typeof queueMicrotask==="undefined"){window.queueMicrotask=function(fn){Promise.resolve().then(fn);}}
if(!Element.prototype.replaceChildren){Element.prototype.replaceChildren=function(){this.innerHTML="";for(var i=0;i<arguments.length;i++){this.appendChild(arguments[i] instanceof Node?arguments[i]:document.createTextNode(arguments[i]));}}}
</script>`;

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // Serve index.html — inject Safari polyfills for iOS compatibility
  app.use("/{*path}", (req: Request, res: Response) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    // Inject polyfill before the closing </head> tag
    html = html.replace("</head>", SAFARI_POLYFILL + "</head>");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
}
