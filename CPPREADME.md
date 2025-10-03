1) Build JupyterLite for a subpath

Build the static C++ site with a base URL of /xcpp/ so all asset URLs and the service worker scope are correct.

# one-time env
python3 -m venv .venv && source .venv/bin/activate
pip install -U pip jupyterlite jupyterlite-xeus

# enable the C++ kernel
cat > environment.yml << 'YAML'
name: xcpp-env
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - xeus-cpp
YAML

# build (note the base-url)
jupyter lite build --base-url /xcpp/ --XeusAddon.environment_file=environment.yml

# output folder (depending on version) is _output or _site:
ls -1 _output

2) Deploy to the web root

Put the generated site under /xcpp/ on the server:

sudo mkdir -p /var/www/html/xcpp
sudo rsync -a _output/ /var/www/html/xcpp/
sudo find /var/www/html/xcpp -type f -exec chmod 644 {} \;
sudo find /var/www/html/xcpp -type d -exec chmod 755 {} \;

3) Nginx: carve out /xcpp/ from the proxy

Edit the csits.kenyon.edu server block. Add this before your generic location / { proxy_pass ... }:

# Serve JupyterLite (C++ in-browser) statically at /xcpp/
location ^~ /xcpp/ {
  alias /var/www/html/xcpp/;
  try_files $uri $uri/ =404;
  # optional caching (tune as you like)
  expires 1h;
}

# Your existing API & socket.io proxies (keep as-is)
location /api/ { proxy_pass http://localhost:4000; ... }
location /socket.io/ { proxy_pass http://localhost:4000/socket.io/; ... }

# Everything else → React app on :4000
location / {
  proxy_pass http://localhost:4000;
  proxy_http_version 1.1;
  proxy_set_header Host              $host;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}


Then reload:

sudo nginx -t && sudo systemctl reload nginx

4) Test

Open https://csits.kenyon.edu/xcpp/lab/
 (JupyterLite Lab UI)

Or https://csits.kenyon.edu/xcpp/repl/
 (lightweight REPL)

You should not see the React app; you should see JupyterLite with a C++ kernel available (“C++” / cpp).

5) Embed in your app (optional)

Add a button or an iframe in your React app that points to the REPL and preloads code:

const code = `#include <iostream>\nint main(){ std::cout<<"Hello POGIL!\\n"; }`;
const src = `/xcpp/repl/index.html?kernel=cpp&toolbar=1&execute=0&code=${encodeURIComponent(code)}`;

<iframe
  src={src}
  style={{ width:'100%', height:520, border:'1px solid #eee', borderRadius:10 }}
  loading="lazy"
/>

Common gotchas

Base URL matters: if you forget --base-url /xcpp/, assets will try to load from / and you’ll get 404s.

Nginx precedence: location ^~ /xcpp/ must be present so /xcpp/* is not proxied to :4000.

Caching: first load is large (WASM toolchain). After the first visit it’s cached by the browser.

If you paste your current Nginx server block, I’ll mark the exact spot to insert the /xcpp/ location.

# 1) Build a static JupyterLite site with C++

Do this on any machine with Python 3.10+ (server or local dev). The result is a folder of static files you can drop under Nginx.

```bash
# 1) fresh env
python3 -m venv .venv && source .venv/bin/activate
pip install -U pip

# 2) install JupyterLite + Xeus loader
# (pip path requires micromamba inside; the package bundles it)
pip install jupyterlite jupyterlite-xeus

# 3) make a build dir
mkdir -p lite && cd lite

# 4) tell jupyterlite-xeus to include the C++ kernel (WebAssembly)
cat > environment.yml << 'YAML'
name: xcpp-env
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - xeus-cpp
YAML

# 5) build the static site
jupyter lite build
# output is in ./_output (or ./_site on some setups)
```

Why this works: **JupyterLite** serves a Jupyter UI that “runs entirely in the browser,” and **jupyterlite-xeus** adds WASM kernels like **xeus-cpp**, so your users get a real C++ REPL with no backend. ([JupyterLite][1])

# 2) Deploy under your domain

Copy the build output to a subfolder, e.g. `/xcpp`, so everything is same-origin with your app.

```bash
sudo mkdir -p /var/www/html/xcpp
sudo rsync -a _output/ /var/www/html/xcpp/
# (or _site/, depending on your jupyterlite version’s output folder)
```

Your Nginx already serves `/var/www/html`, so you can visit:

* **Lab:** `https://jimskon.com/xcpp/lab/`
* **REPL:** `https://jimskon.com/xcpp/repl/`

(These are the standard JupyterLite apps; nothing to proxy.) ([JupyterLite][1])

# 3) Embed a C++ console in POGIL-ITS

Use the **REPL** app in an iframe and prefill it with starter code via URL params (kernel selection, code, toolbar, etc. are all supported):

```html
<iframe
  id="cpp-repl"
  src="/xcpp/repl/index.html?kernel=cpp&toolbar=1&theme=JupyterLab%20Dark&execute=0&code=%23include%20%3Ciostream%3E%0Aint%20main()%7Bstd%3A%3Acout%20%3C%3C%20%22Hello%20POGIL!%5Cn%22%3B%7D"
  style="width:100%; height:520px; border:1px solid #eee; border-radius:10px;"
  loading="lazy"
></iframe>
```

Notes:

* The REPL’s URL parameters are documented (choose kernel, inject code, show toolbar, etc.). ([JupyterLite][2])
* **Kernel name** is often `cpp` for xeus-cpp. If you still see a kernel picker, try `kernel=c%2B%2B` or just omit the param and select “C++” once; JupyterLite remembers per-origin. (Kernel names come from the built kernelspecs.) ([JupyterLite Xeus][3])

If you want to trigger it from React:

```jsx
// Minimal C++ block component
export function CppBlock({ code }) {
  const encoded = encodeURIComponent(code);
  const src = `/xcpp/repl/index.html?kernel=cpp&toolbar=1&execute=0&code=${encoded}`;
  return <iframe src={src} style={{width:'100%',height:520,border:'1px solid #eee',borderRadius:10}} loading="lazy" />;
}
```

# 4) (Optional) Preload starter files / headers

You can “mount” extra files into the in-browser filesystem at build time (great for templates, headers, sample projects):

```bash
jupyter lite build \
  --XeusAddon.environment_file=environment.yml \
  --XeusAddon.mounts=/path/to/starter:/home/pyodide/starter
```

Those files then appear inside the REPL/Lab file browser for students. ([JupyterLite Xeus][3])

# 5) What to expect (UX & size)

* First load is **tens of MB** (Clang/LLVM, stdlib) and may take ~seconds on slower networks; after that it’s cached. This is the trade-off for **100% client-side** C++. ([Jupyter Blog][4])
* It’s a true **C++ REPL** powered by **Clang-Repl** under the hood via xeus-cpp, not a toy interpreter. ([compiler-research.org][5])

---

If you’d like, I can also add a tiny “Run in C++ (browser)” button to your activity renderer that feeds the current cell’s code straight into the iframe (using the `code=` param as above).

[1]: https://jupyterlite.readthedocs.io/ "JupyterLite — JupyterLite 0.6.4 documentation"
[2]: https://jupyterlite.readthedocs.io/en/stable/quickstart/embed-repl.html "Embed a live REPL on a website — JupyterLite 0.6.4 documentation"
[3]: https://jupyterlite-xeus.readthedocs.io/ "xeus kernels in JupyterLite  — jupyterlite-xeus  documentation"
[4]: https://blog.jupyter.org/c-in-jupyter-interpreting-c-in-the-web-c9d93542f20b?utm_source=chatgpt.com "C++ in Jupyter — Interpreting C++ in the Web | by Anutosh Bhat"
[5]: https://compiler-research.org/assets/presentations/Anutosh_Bhat_Xeus-Cpp-Lite.pdf?utm_source=chatgpt.com "Xeus-Cpp-Lite - Interpreting C++ in the Browser"
