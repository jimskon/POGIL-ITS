export async function runSkulptCode({ code, fileContents, setOutput }) {
  setOutput('');

  if (!window.Sk || !Sk.configure) {
    setOutput('❌ Skulpt not loaded');
    return;
  }

  // ✅ Expose setFileContent so Python code can call it
  window.setFileContent = function (filename, content) {
    if (fileContents && filename) {
      // UNWRAP Skulpt string objects
      if (typeof filename === 'object' && filename.v !== undefined) {
        filename = filename.v;
      }
      if (typeof content === 'object' && content.v !== undefined) {
        content = content.v;
      }
      fileContents[filename] = String(content);
    }
  };

  // ✅ Setup Skulpt external js module
  Sk.externalLibraries = {
    js: {
      path: '',
      dependencies: [],
      load: () => {
        console.log("[Skulpt external load] returning js module");
        return {
          setFileContent: new Sk.builtin.func((filename, content) => {
            console.log("[Skulpt setFileContent] called with", filename, content);
            window.setFileContent(filename, content);
            return Sk.builtin.none.none$;
          }),
          document: window.document,
        };
      },
    },
  };

  // ✅ Prepare file dictionary for injection
const __fileDict = Object.entries(fileContents || {}).map(
  ([name, content]) =>
    `"${name}": """${String(content).replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`
).join(",\n  ");



  //print ("Injecting files:", __fileDict);

  const injectedPython = `
__files__ = {
  ${__fileDict}
}

for k in __files__:
    __files__[k] = str(__files__[k])

def safe_split_lines(content):
    # Always get a real Python str
    try:
        content = str(content)
    except Exception as e:
        print("Error coercing to string:", e)
        content = ""
    # Split manually (avoiding .splitlines() bug in Skulpt)
    result = []
    current = ""
    for c in content:
        if c == "\\n":
            result.append(current + "\\n")
            current = ""
        else:
            current += c
    if current:
        result.append(current)
    print("Safe split lines result:", result)
    return result

class FakeFile:
    def __init__(self, name, content):
        content = str(content)
        print("TYPE:", type(content), "CONTENT:", content, "DIR:", dir(content))
        print("IF POSSIBLE v:", getattr(content, 'v', 'no v'))
        #self.lines = str(content).split("\\n")
        self.lines = [str(line) for line in safe_split_lines(content)]

        self.index = 0
        self.closed = False
        self.name = name
        self.content = content

    def read(self):
        print("Reading file:", self.name, "Content length:", len(self.lines))
        return ''.join(self.lines[self.index:])

    def readline(self):
        if self.index < len(self.lines):
            line = self.lines[self.index]
            self.index += 1
            return line
        return ''

    def write(self, s):
        s = str(s)
        self.content += s

        print("Writing to file:", self.name, "Content:", s)
        print("Type of content:", type(self.content))
        self.lines = safe_split_lines(self.content)

        setFileContent = __import__('js').setFileContent
        setFileContent(self.name, self.content)

        jsdoc = __import__('js').document
        selector = 'textarea[data-filename="{}"]'.format(self.name)
        textarea = jsdoc.querySelector(selector)
        if textarea:
            textarea.value = self.content


    def close(self):
        self.closed = True

    def __iter__(self):
        for line in self.lines[self.index:]:
            yield line

def open(filename, mode='r'):
    if filename in __files__:
        return FakeFile(filename, __files__[filename])
    else:
        raise FileNotFoundError("No such file: {}".format(filename))
`;

  const finalCode = injectedPython + '\n' + code;
  console.log("📜 Final code to run:", finalCode);

  Sk.python3 = true;
  Sk.configure({
    output: (txt) => setOutput((prev) => prev + txt),
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

  try {
    Sk.execLimit = 50000;
    Sk.sysmodules = new Sk.builtin.dict([]);
    await Sk.misceval.asyncToPromise(() => {
      return Sk.importMainWithBody('<stdin>', false, finalCode, true);
    });
  } catch (e) {
    const errText = Sk.misceval.printError ? Sk.misceval.printError(e) : e.toString();
    setOutput((prev) => prev + "\n❌ Error: " + errText);
  }
}
