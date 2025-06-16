export async function runSkulptCode({ code, fileContents, setOutput }) {
  setOutput('');
  console.log("🚀 runSkulptCode with full file system support invoked");

  // ✅ Required for Python 3 behavior
  Sk.python3 = true;

  // ✅ Configure Skulpt with a working virtual filesystem
  Sk.configure({
    output: (text) => setOutput((prev) => prev + text),
    inputfunTakesPrompt: true,
    fileSystem: "inmemory",  // ✅ enable FS support
    read: (filename) => {
      if (Sk.builtinFiles?.files[filename]) {
        return Sk.builtinFiles.files[filename];
      }
      throw new Sk.builtin.IOError(`File not found: '${filename}'`);
    },
    __future__: {
      nested_scopes: false,
      generators: false,
      division: true,
      absolute_import: true,
      with_statement: true,
      print_function: true,
      unicode_literals: true,
      generator_stop: true,
      annotations: true,
      barry_as_FLUFL: false,
      braces: false,
      generator_exp: true,
      importlib: true,
      optimizations: false,
      top_level_await: false,
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
  

  // ✅ Write initial virtual files to the in-memory FS
  if (!Sk.fs) {
    console.error("❌ Sk.fs is not defined. You may need to upgrade Skulpt or load the fs module.");
    setOutput("Error: Skulpt filesystem not available.");
    return;
  }

  for (const [filename, content] of Object.entries(fileContents)) {
    try {
      console.log(`📄 Injecting virtual file: ${filename}`);
      Sk.fs.writeFile(filename, content);
    } catch (e) {
      console.error(`❌ Failed to write file ${filename}:`, e);
    }
  }

  try {
    console.log("🕒 Executing Python code...");
    await Sk.misceval.asyncToPromise(() =>
      Sk.importMainWithBody("<stdin>", false, code, true)
    );
  } catch (err) {
    let formattedError;
    try {
      formattedError = Sk.misceval.printError(err);
    } catch (formatErr) {
      formattedError = err.toString();
    }
    console.error("❌ Skulpt error:", formattedError);
    setOutput((prev) => prev + `\nError: ${formattedError}`);
  }
}
