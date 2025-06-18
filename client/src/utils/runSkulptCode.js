export async function runSkulptCode({ code, fileContents, setOutput }) {
  setOutput('');

  if (!window.Sk || !Sk.configure) {
    setOutput('❌ Skulpt not loaded');
    return;
  }

  Sk.python3 = true;

  const files = { ...fileContents };
  const fileSystem = {
    open: (filename, modeObj) => {
      console.log('Opening file:', filename, 'with mode:', modeObj);
      const filenameStr = filename.v ? filename.v : filename;
      const mode = modeObj.v || 'r';
      let content = files[filenameStr] || '';
      let ptr = mode.includes('a') ? content.length : 0;

      return {
        name: filenameStr,
        mode,
        closed: false,
        readline: () => {
          if (ptr >= content.length) return Sk.builtin.none.none$;
          const nl = content.indexOf('\n', ptr);
          const end = nl === -1 ? content.length : nl + 1;
          const line = content.slice(ptr, end);
          ptr = end;
          return new Sk.builtin.str(line);
        },
        read: () => new Sk.builtin.str(content.slice(ptr)),
        write: (s) => {
          const str = s.v !== undefined ? s.v : s.toString();
          if (mode.includes('a')) content += str;
          else {
            content = content.slice(0, ptr) + str + content.slice(ptr + str.length);
          }
          ptr += str.length;
          files[filenameStr] = content;
        },
        close: () => { this.closed = true; }
      };
    },
    builtinRead: (fname) => {
      if (Sk.builtinFiles?.files[fname]) {
        return Sk.builtinFiles.files[fname];
      }
      throw new Error(`builtinRead: file not found: ${fname}`);
    }
  };
  console.log("Filesystem:",fileSystem);
  Sk.configure({
    output: (txt) => setOutput((prev) => prev + txt),
    inputfunTakesPrompt: true,
    fileSystem,
    read: fileSystem.builtinRead,
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

  console.log("Filesystem2:",fileSystem);
  // Confirm injection
  console.log('Injected files:', Object.keys(files));
  console.log('sports.txt content snippet:', files['sports.txt']?.slice(0, 50));

  try {
    await Sk.misceval.asyncToPromise(() =>
      Sk.importMainWithBody('<stdin>', false, code, true)
    );
  } catch (e) {
    const errText = Sk.misceval.printError ? Sk.misceval.printError(e) : e.toString();
    setOutput((prev) => prev + `\n❌ Error: ${errText}`);
  }
}
