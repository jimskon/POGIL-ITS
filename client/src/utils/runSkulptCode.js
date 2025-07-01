export async function runSkulptCode({ code, fileContents, setOutput, setFileContents }) {
  setOutput('');

  if (!window.Sk || !Sk.configure) {
    setOutput('❌ Skulpt not loaded');
    return;
  }

  /** ✅ 1. Build initial file dictionary as a Python literal */
  const __fileDict = Object.entries(fileContents || {}).map(
    ([name, content]) =>
      `"${name}": """${String(content).replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`
  ).join(",\n  ");

  /** ✅ 2. Injected Python shims for open(), FakeFile, etc. */
  const injectedPython = `
__files__ = {
  ${__fileDict}
}

for k in __files__:
    __files__[k] = str(__files__[k])

class FakeFile:
    def __init__(self, name, content):
        self.name = name
        self.content = str(content)
        self.index = 0
        self.closed = False

    def read(self):
        return self.content[self.index:]

    def readline(self):
        newline_index = self.content.find("\\n", self.index)
        if newline_index == -1:
            line = self.content[self.index:]
            self.index = len(self.content)
            return line
        line = self.content[self.index: newline_index + 1]
        self.index = newline_index + 1
        return line

    def write(self, s):
        s = str(s)
        self.content += s
        print("##FILEWRITE## {} {}".format(self.name, self.content))

    def close(self):
        self.closed = True

    def __iter__(self):
        while self.index < len(self.content):
            yield self.readline()

def open(filename, mode='r'):
    if filename in __files__:
        return FakeFile(filename, __files__[filename])
    else:
        raise FileNotFoundError("No such file: {}".format(filename))
`;

  /** ✅ 3. User code appended */
  const finalCode = injectedPython + '\n' + code;

  /** ✅ 4. Configure Skulpt runtime */
  Sk.python3 = true;
  Sk.configure({
    output: (txt) => {
      if (txt.startsWith('##FILEWRITE## ')) {
        // Special marker line from Python
        const payload = txt.slice('##FILEWRITE## '.length);
        const spaceIndex = payload.indexOf(' ');
        if (spaceIndex !== -1) {
          const filename = payload.slice(0, spaceIndex);
          const content = payload.slice(spaceIndex + 1);
          console.log("[runSkulptCode] Intercepted FILEWRITE:", filename, content);
          if (setFileContents) {
            setFileContents(prev => ({
              ...prev,
              [filename]: content
            }));
          }
        }
      } else {
        // Normal print output
        setOutput((prev) => prev + txt);
      }
    },
    inputfunTakesPrompt: true,
    read: (fname) => {
      if (Sk.builtinFiles?.files[fname]) {
        return Sk.builtinFiles.files[fname];
      }
      throw new Error("File not found: " + fname);
    },
    syspath: ['.'],
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

  /** ✅ 5. Run user's code */
  try {
    Sk.execLimit = 50000;
    Sk.sysmodules = new Sk.builtin.dict([]);
    await Sk.misceval.asyncToPromise(() =>
      Sk.importMainWithBody('<stdin>', false, finalCode, true)
    );
  } catch (e) {
    const errText = Sk.misceval.printError
      ? Sk.misceval.printError(e)
      : e.toString();
    setOutput((prev) => prev + "\n❌ Error: " + errText);
  }
}
