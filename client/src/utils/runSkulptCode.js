export async function runSkulptCode({ code, fileContents, setOutput, setFileContents, execLimit = 50000 }) {
  setOutput('');

  if (!window.Sk || !Sk.configure) {
    setOutput('❌ Skulpt not loaded');
    return;
  }

  const __fileDict = Object.entries(fileContents || {}).map(
    ([name, content]) => `"${name}": ${JSON.stringify(content)}`
  ).join(",\n  ");


  const injectedPython = `
__files__ = {
  ${__fileDict}
}

class FakeFile:
    def __init__(self, name, content):
        self.lines = content.splitlines(True)
        self.index = 0
        self.closed = False
        self.name = name
        self.content = content

    def read(self):
        return ''.join(self.lines[self.index:])

    def readline(self):
        if self.index < len(self.lines):
            line = self.lines[self.index]
            self.index += 1
            return line
        return ''

    def write(self, s):
        self.content += s
        print("##FILEWRITE## {} {}".format(self.name, self.content))
        __files__[self.name] += s

    def close(self):
        self.closed = True

    def __iter__(self):
        for line in self.lines[self.index:]:
            yield line

def open(filename, mode='r'):
    if 'w' in mode:
        __files__[filename] = ""
        return FakeFile(filename, "")
    elif filename in __files__:
        return FakeFile(filename, __files__[filename])
    else:
        raise FileNotFoundError("No such file: {}".format(filename))

`;

  const finalCode = injectedPython + '\n' + code;
  // how many lines were injected before the user's code?
  const injectedLineCount = (injectedPython.match(/\n/g) || []).length + 1; // +1 for the extra '\n' we added
  //console.log("📜 Final code to run:", finalCode);

  Sk.python3 = true;

  Sk.configure({
    output: (txt) => {
      if (txt.startsWith('##FILEWRITE## ')) {
        const payload = txt.slice('##FILEWRITE## '.length);
        const spaceIndex = payload.indexOf(' ');
        if (spaceIndex !== -1) {
          const filename = payload.slice(0, spaceIndex);
          const content = payload.slice(spaceIndex + 1);
          //console.log("[runSkulptCode] FILEWRITE detected:", filename, content);
          // Save to your React state
          if (setFileContents) {
            setFileContents(prev => ({
              ...prev,
              [filename]: content
            }));
          }
        }
      } else {
        setOutput((prev) => prev + txt);
      }
    },
    // Put the input prompt in the dialog box
    inputfun: (promptText) => {
      // Use the browser prompt; coerce null (Cancel) to empty string
      const val = window.prompt(promptText ?? '') ?? '';
      // Skulpt is fine with either a string or a Promise<string>; Promise is safest
      return Promise.resolve(val);
    },
    inputfunTakesPrompt: true,

    __future__: {
      nested_scopes: true,
      generators: true,
      division: true,
      absolute_import: true,
      with_statement: true,
      print_function: true,
      unicode_literals: true,
      generator_stop: true,
      annotations: true,
      barry_as_FLUFL: true,
      braces: false,
      generator_exp: true,
      importlib: true,
      optimizations: true,
      top_level_await: true,
      variable_annotations: true,
      class_repr: true,
      inherit_from_object: true,
      super_args: true,
      octal_number_literal: true,
      bankers_rounding: true,
      python_version: true,
      dunder_round: true,
      exceptions: true,
      no_long_type: true,
      ceil_floor_int: true,
      silent_octal_literal: true,
    }
  });

  function formatSkErrorOffset(e, offset) {
    try {
      // Prefer structured traceback when available
      if (e && Array.isArray(e.traceback) && e.traceback.length) {
        const tb = e.traceback;
        const lines = ["Traceback (most recent call last):"];
        for (let i = tb.length - 1; i >= 0; i--) {
          const f = tb[i];
          const file = f.filename || '<stdin>';
          const func = f.func || '<module>';
          const isUser = /<stdin>(?:\.py)?$/i.test(file);
          const lineno = Math.max(1, (f.lineno || 1) - (isUser ? offset : 0));
          lines.push(`  File "${file}", line ${lineno}, in ${func}`);
        }

        // Adjust a trailing “… on line N” inside the exception text too
        const msgRaw = e.toString ? e.toString() : (e.message || String(e));
        const msg = msgRaw.replace(/(on line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        );

        return lines.join('\n') + '\n' + msg;
      }

      // Fallback: rewrite Skulpt’s pretty-printed string
      const raw = (Sk.misceval.printError ? Sk.misceval.printError(e) : String(e));
      return raw
        // File "<stdin>" or "<stdin>.py", line N
        .replace(/(File\s+"<stdin>(?:\.py)?",\s+line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        )
        // “… on line N”
        .replace(/(on line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        );
    } catch {
      return (Sk.misceval.printError ? Sk.misceval.printError(e) : String(e));
    }
  }

try {
  Sk.execLimit = execLimit;
  Sk.python3 = true;
  //console.log("🚀 Running with fileContents:", fileContents); 
  await Sk.misceval.asyncToPromise(() => {
    return Sk.importMainWithBody('<stdin>', false, finalCode, true);
  });
} catch (e) {
  const errText = formatSkErrorOffset(e, injectedLineCount);
  setOutput(prev => prev + "\n❌ Error:\n" + errText);
}

}
