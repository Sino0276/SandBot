import type { Messages } from './ko'

const en: Messages = {
  common: {
    dismiss: 'Dismiss',
    cancel: 'Cancel'
  },
  toolbar: {
    language: 'Language',
    lengthUnit: 'Length unit',
    noProject: 'Unsaved scene',
    open: 'Open',
    openShortcut: 'Open an FtcRobotController folder (Ctrl+O)',
    save: 'Save',
    saveShortcut: 'Save (Ctrl+S)',
    undo: 'Undo',
    undoShortcut: 'Undo (Ctrl+Z)',
    redo: 'Redo',
    redoShortcut: 'Redo (Ctrl+Shift+Z or Ctrl+Y)',
    // Preferences window (Unity's Edit > Preferences)
    preferences: 'Preferences',
    preferencesTooltip: 'Preferences (external script editor)'
  },
  project: {
    chooseFolderTitle: 'Choose the FtcRobotController folder',
    chooseStepTitle: 'Choose a STEP file'
  },
  dialog: {
    unsavedChanges: 'You have unsaved changes. Save them?',
    chooseLengthUnit:
      'Which unit should lengths be shown in? You can change it in the toolbar at any time.',
    overwriteProject:
      '{{name}} already has a SandBot project. Overwrite it with the current scene?',
    save: 'Save',
    discard: "Don't save",
    overwrite: 'Overwrite',
    cancel: 'Cancel',
    importLarge: '{{fileName}} is {{size}}. The first import can take a few minutes. Import it?',
    importLargeMany:
      'You are importing {{count}} large STEP files ({{size}} in total). The first import can take a few minutes. Import them?',
    importLargeWasm:
      '{{fileName}} is {{size}}. This PC has no fast converter, so SandBot uses its built-in reader, which may fail or take a very long time on a file this large. Import it anyway?',
    importLargeManyWasm:
      'You are importing {{count}} large STEP files ({{size}} in total). This PC has no fast converter, so SandBot uses its built-in reader, which may fail or take a very long time on files this large. Import them anyway?',
    import: 'Import',
    closeWhileImporting:
      'A STEP file is still being imported. Closing now cancels the import. Close anyway?',
    close: 'Close',
    deleteWithCadParts:
      'This also deletes {{count}} object(s) from the deleted CAD that you moved to other groups, and the {{components}} hardware component(s) on them. You can undo it with {{undo}}. Delete?',
    deleteWithCadPartsNoHardware:
      'This also deletes {{count}} object(s) from the deleted CAD that you moved to other groups. You can undo it with {{undo}}. Delete?',
    delete: 'Delete'
  },
  notice: {
    importing: 'Importing {{fileName}}…',
    importReadFailed: 'Could not read {{fileName}} as a STEP file.',
    importEmpty: '{{fileName}} contains no geometry to import.',
    importFailed: 'Something went wrong while importing {{fileName}}.',
    importMeshFailed:
      'Could not create the geometry (triangles) of {{fileName}}. Try exporting it again from your CAD program.',
    importOutOfMemory:
      'Ran out of memory while importing {{fileName}}. Close other programs and try again. If it still fails, remove small parts such as screws in your CAD program and export again.',
    importTooLarge:
      '{{fileName}} is too large for the built-in reader. In your CAD program (Onshape, Fusion 360, …), remove small parts such as screws or anything you do not need, and export again.',
    importPartial:
      '{{count}} part(s) of {{fileName}} could not be turned into geometry and are not shown.',
    importIncomplete:
      'Some shapes of {{fileName}} could not be converted and may be missing (the PC may have run out of memory). Close other programs and import it again, or export it again from your CAD program.',
    cadLoadIncomplete:
      'Some shapes of {{fileName}} could not be converted, so it was not loaded (the PC may have run out of memory). Close other programs and click [Reload] in the inspector.',
    cadLoadCancelled:
      'Stopped importing {{fileName}}. Use [Reload] in the inspector to import it again.',
    openingProject: 'Opening {{name}}…',
    openFailed: 'Could not open the project ({{detail}}).',
    saveFailed: 'Could not save ({{detail}}).',
    noTeamCode: '{{name}} has no TeamCode folder. Make sure it is an FtcRobotController folder.',
    cadMissing:
      'Could not find {{count}} CAD file(s). Use [Locate file] in the Inspector to relink.',
    cadChanged:
      'The part count of {{fileName}} differs from when it was saved. The CAD may have changed, so some parts may not match.',
    codegenBlocked:
      'The hardware setup has {{count}} error(s), so no TeamCode code was generated. Check the inspector.',
    codegenNoTeamCode: 'There is no TeamCode folder, so the hardware code was not generated.',
    codegenSkipped:
      'Not overwritten because a hand-written file has the same name: {{files}}. Change the class name under Robot hardware.',
    codegenModified:
      'Not overwritten because these generated files were edited: {{files}}. Delete a file to let SandBot generate it again.',
    codegenCaseRenamed:
      'Only the letter case of generated file names changed ({{files}}). Git on Windows and macOS does not record this, so rename them with git mv -f when you commit.',
    codegenFailed: 'Could not write the generated code to TeamCode ({{detail}}).',
    // Script links and the external editor (phase 2)
    scriptOpenFailed:
      'Could not open {{fileName}} ({{detail}}). No app may be associated with .java files. Choose an External Script Editor in the toolbar [Preferences] > External Tools.',
    scriptLaunchFailed:
      'The external script editor could not open {{fileName}} ({{detail}}). Check the editor in the toolbar [Preferences] > External Tools.',
    scriptMissing: '{{fileName}} is not in TeamCode. Check the link in the Inspector.',
    scriptNotAllowed:
      '{{fileName}} is not a path SandBot opens. Only Java files inside TeamCode/src/main/java can be opened.',
    lineIgnored:
      "The external script editor can't take a line number, so only the file was opened. Choose Android Studio or another editor in Preferences to open at the line.",
    // Usages (phase 4): TeamCode that a save breaks. One notice, replaced on every save. {{files}} lists up to 3 file names.
    usagesBroken:
      "{{count}} place(s) in TeamCode ({{files}}) use names the saved generated code doesn't have. Open them from Usages in the Inspector.",
    usagesBrokenByName:
      "Configuration names changed; {{count}} string(s) in TeamCode ({{files}}) won't find their device at run time.",
    scriptLinksDropped:
      '{{count}} script links in project.json were dropped because their paths are not allowed or repeat on the same object. Saving removes them from the file too.',
    externalEditorFailed: 'Could not change the external script editor setting ({{detail}}).',
    externalEditorUnsupportedFile:
      'The chosen file cannot be run as the external script editor. Choose the editor executable (.exe on Windows); .bat, .cmd, .lnk and .ps1 files cannot be used.',
    externalEditorInvalidArgs:
      'The arguments were not changed. Include $(File), close every double quote, and keep them on one line and not too long.',
    // Saving tunables (phase 3). Values are Java literal text.
    tunableConflict:
      "{{field}} in {{file}} was changed outside SandBot (file value {{fileValue}}), so SandBot's value {{value}} was not saved and the file value was kept.",
    tunableMissing:
      'Tunables were not saved because the file or field was not found in {{file}} (deleted or renamed): {{fields}}',
    tunableWriteFailed:
      'Could not write tunables to {{file}} ({{detail}}). The values are still unsaved; try saving again.',
    tunableFileBusy:
      '{{file}} kept changing while saving, so its tunables were not written. The values are still unsaved; save again in a moment.',
    tunableFileReadOnly:
      '{{file}} is read-only (you cannot write to the file or its folder), so its tunables were not written. Make the file and its folder writable, then save again. The values are still unsaved.',
    tunableFileTooLarge:
      '{{file}} is larger than 1 MB, so its tunables were not written. Make the file smaller than 1 MB, then save again. The values are still unsaved.',
    tunableFileEncoding:
      '{{file}} cannot be round-tripped as UTF-8 (another encoding), so its tunables were not written. Change the file encoding to UTF-8 in your editor, then save again. The values are still unsaved.',
    tunableFileGenerated:
      '{{file}} has the SandBot generated marker (@sandbot-generated), so its tunables were not written. If your team maintains this file, remove the marker, then save again. The values are still unsaved.',
    tunableFileUnicodeEscape:
      '{{file}} has \\u escapes outside literals (in comments, etc.; javac translates them first, so positions cannot be trusted), so its tunables were not written. Remove those \\u escapes, then save again. The values are still unsaved.',
    tunableFileNotAllowed:
      '{{file}} is no longer a regular file inside TeamCode/src/main/java (for example, a link pointing outside), so its tunables were discarded without being written: {{fields}}'
  },
  importPhase: {
    checking: 'checking the file',
    queued: 'waiting for another file to finish',
    read: 'reading the file',
    transfer: 'converting shapes',
    mesh: 'creating triangles',
    write: 'finishing up',
    build: 'adding to the scene',
    wasm: 'reading with the built-in reader'
  },
  units: {
    symbols: {
      mm: 'mm',
      cm: 'cm',
      m: 'm',
      in: 'in'
    },
    names: {
      mm: 'mm (millimeters)',
      cm: 'cm (centimeters)',
      m: 'm (meters)',
      in: 'in (inches)'
    },
    lengthInputHint:
      'You can type a unit (e.g. 12in, 30cm, 150mm). Without one, the value is read in {{unit}}.',
    angleInputHint: 'Degrees (°). Add rad to enter radians.'
  },
  panels: {
    hierarchy: 'Hierarchy',
    scene: 'Scene',
    inspector: 'Inspector'
  },
  objectKind: {
    robot: 'Robot',
    assembly: 'Assembly',
    part: 'Part',
    group: 'Group'
  },
  scene: {
    tool: 'Tool',
    tools: {
      view: 'Hand tool: drag with the left button to pan (Q)',
      translate: 'Move (W)',
      rotate: 'Rotate (E)'
    },
    flySpeed: 'Fly speed {{speed}} {{unit}}/s · scroll to change, Shift for faster',
    handleSpace: "Handle axes: Global (field axes) · Local (the object's own axes) (X)",
    global: 'Global',
    local: 'Local'
  },
  hierarchy: {
    empty: 'No objects in the scene',
    emptyHint: 'Drop a STEP file onto the window or click [Import STEP].',
    importStep: 'Import STEP',
    expand: 'Expand',
    collapse: 'Collapse',
    create: 'Create Empty',
    createTooltip: 'Create Empty ({{shortcut}})',
    renameLabel: 'Object name',
    menu: {
      label: 'Hierarchy menu',
      rename: 'Rename',
      delete: 'Delete',
      createEmpty: 'Create Empty',
      createEmptyParent: 'Create Empty Parent'
    }
  },
  inspector: {
    empty: 'No object selected',
    transform: 'Transform',
    position: 'Position',
    rotation: 'Rotation',
    frameField: 'Field frame',
    frameFieldHint: 'Field coordinates. The origin is the field center on the floor, and Z is up.',
    frameParent: 'Parent frame',
    frameParentHint:
      "Relative to the position and axes of the parent '{{name}}'. Moves along with the parent.",
    cadAxes: 'Shown in the CAD file axes (up {{up}} · forward {{forward}}).',
    robotCenter: 'From robot center',
    robotCenterHint:
      'Position seen from the robot origin (center, on the floor): X forward · Y left · Z up. It is calculated, so it cannot be edited.',
    cad: {
      title: 'CAD alignment',
      hint: "Maps the CAD's up/forward axes to the robot's up (Z) and forward (X), and puts the bottom center at the robot origin.",
      preset: 'Preset',
      presetYUp: 'Y-up (Fusion 360 default · SolidWorks · Inventor)',
      presetZUp: 'Z-up (Onshape · Fusion 360 Z-up)',
      presetCustom: 'Custom',
      upAxis: 'Up axis',
      forwardAxis: 'Forward axis',
      missing: 'File not found',
      loading: 'Loading',
      failed: 'Could not load the geometry',
      cancelled: 'Import stopped',
      relink: 'Locate file',
      reload: 'Reload'
    },
    // 메커니즘 그룹(1단계): 이름 칸, 다중 선택, 그룹 코드, CAD 밖으로 옮긴 파트
    name: 'Name',
    multiple: '{{count}} objects selected',
    multipleHint:
      'Editing several objects at once is not available yet. Click an object in the list to select only it. Ctrl+click removes it from the selection.',
    multipleMore: '{{count}} more',
    group: {
      title: 'Mechanism group',
      className: 'Java class name',
      classNameHint:
        'Name of the nested class inside the generated hardware class. Leave it empty to derive it from the group name (shown dimmed). Start with a capital English letter and use only English letters and digits.',
      access: 'Access path',
      accessHint: 'How an OpMode reaches this group. robot is the hardware class variable.',
      constants: 'Type name',
      constantsHint:
        'Constants of the devices in this group (offsets and so on) are reached through this type name. Reaching them through robot.… makes Android Studio warn.',
      noHardware: 'A group without hardware does not generate a class.'
    },
    cadOrigin: {
      title: 'CAD source',
      hint: "Moved out of the CAD '{{name}}'. It moves when that CAD's alignment changes and is deleted with that CAD.",
      select: 'Select CAD root'
    },
    // Component list (hardware component and script link cards, like Unity's component list)
    components: 'Components',
    componentsEmpty: 'No components attached.',
    // Tunables (phase 3): FTC Dashboard @Config fields inside the script card
    tunables: {
      loading: 'Reading tunables…',
      readFailed: 'Could not read the file, so its tunables are not shown.',
      configTag: '@Config',
      blockLabel: 'Tunables {{name}}',
      blockHint: 'Class {{classPath}}, shown in FTC Dashboard as the ‘{{name}}’ group.',
      fieldHint:
        '{{declaration}} · line {{line}}. Double-click to open this line in the external script editor.',
      pending: 'Unsaved value. It is written to the Java file when you save (Ctrl+S).',
      fileChanged: 'File value: {{value}}',
      fileChangedHint:
        "This value was changed in the file outside SandBot (Android Studio, etc.). If you save now, SandBot's value is not written and the file value is kept. Click [Use SandBot value] or enter a new value to write it instead of the file value when you save.",
      keepValue: 'Use SandBot value',
      keepValueHint:
        "Write SandBot's value instead of the changed file value when you save (can be undone).",
      useFileValue: 'Use file value',
      useFileValueHint: "Discard SandBot's unsaved value and use the file value (can be undone).",
      pendingFileLocked:
        'Unsaved value. This file cannot be edited now, so saving does not write it and it stays unsaved. It is written when you save after making the file editable.',
      pendingFieldLocked:
        'Unsaved value. This field was changed outside SandBot and can no longer be edited, so when you save, this value is not written and the file value is kept.',
      pendingFieldMissing:
        'Unsaved value. This field was not found in the file (deleted or renamed), so when you save, this value is not written and you are notified.',
      noConfig: "Add FTC Dashboard's @Config to edit public static fields here.",
      sharedHint:
        'These values are static, so every object linked to this file shows the same values. They are written to the Java file when you save (Ctrl+S).',
      dashboardHint:
        'Values changed on the robot through FTC Dashboard live only in robot memory and do not appear here.',
      readOnly: {
        expression: 'Expression, read-only',
        noInitializer: 'No initial value, read-only',
        textBlock: 'Text block or string with \\u, read-only',
        lineBreak: 'String with a line break, read-only',
        initializedInType: 'Set by a constructor or initializer block, read-only',
        unicodeEscape: 'The file has \\u escapes, read-only',
        null: 'null, read-only',
        enum: 'Enum values cannot be edited yet',
        object: 'Not new Type() of a type in this file, not expanded',
        unsupportedType: 'Unsupported type, read-only',
        file: 'The file cannot be edited'
      },
      fileReadOnly: {
        encoding:
          'This file cannot be round-tripped as UTF-8 (another encoding), so its tunables are read-only.',
        generated: 'This file was generated by SandBot, so its tunables are not edited.',
        readOnly:
          'This file is read-only (you cannot write to the file or its folder), so its tunables can only be viewed. Make the file and its folder writable to edit them.',
        tooLarge: 'This file is larger than 1 MB, so its tunables are not read.',
        unicodeEscape:
          'This file has \\u escapes (javac translates them first, so positions cannot be trusted), so its tunables are read-only.'
      }
    }
  },
  // Script links (navigation links shown like Unity script components, phase 2)
  scripts: {
    tag: 'Script',
    field: 'Script',
    fieldHint:
      'Double-click to open in the External Script Editor. Choose the editor in the toolbar [Preferences].',
    open: 'Open',
    openLabel: 'Open {{name}}',
    remove: 'Remove',
    removeLabel: 'Remove link to {{name}}',
    navigationHint:
      'A navigation link. The generated hardware code does not reference this file, and its code runs as before.',
    missing: 'File not found',
    checking: 'Checking…',
    relink: 'Relink:',
    relinkHint:
      'Found exactly one file with the same class (or the same name) at this location in TeamCode. Click to link to it instead (undoable).',
    notFound:
      'No single file with the same class or the same name was found in TeamCode. Remove the link and link the file again from [Add Component].',
    unknown:
      'Could not read the whole TeamCode file list, so SandBot cannot tell whether this file exists.',
    noProject: 'Open or save a project to find and open this file in TeamCode.',
    noTeamCode: 'The project has no TeamCode folder, so this file cannot be opened.',
    usesHardware: 'Hardware this script uses',
    usesHardwareHint:
      'Devices, groups and robots this file uses, from Usages (generated code and strings that look a device up by name). Click one to select it.',
    addGroup: 'Scripts',
    addOption: 'TeamCode script…',
    badge: '{ }',
    badgeTitle: 'Linked scripts: {{names}}',
    picker: {
      label: 'Choose a TeamCode script',
      placeholder: 'Search by class name',
      loading: 'Reading the TeamCode file list…',
      empty: 'There are no Java files that can be linked.',
      allLinked: 'Every Java file in TeamCode is already linked.',
      noMatch: 'No files match ‘{{query}}’.',
      noProject: 'Open or save a project to choose TeamCode scripts.',
      noTeamCode: 'The project has no TeamCode folder.',
      failed: 'Could not read the TeamCode file list.',
      truncated: 'There are too many files; only some are shown.',
      more: '{{count}} more · type to narrow down',
      defaultPackage: '(default package)'
    }
  },
  usages: {
    title: 'Usages',
    code: 'Code {{count}}',
    byName: 'By name {{count}}',
    warnings: '{{count}} problem(s)',
    none: 'No usages found',
    searched: 'Searched for: {{terms}}',
    scanning: 'Searching…',
    partialBadge: '(partial)',
    failed: 'Could not search for usages: {{detail}}',
    failedNoDetail: 'Could not search for usages.',
    noProject: 'Open or save a project to find usages in TeamCode.',
    noTeamCode: "The project has no TeamCode folder, so usages can't be found.",
    truncated: 'TeamCode has too many files; only the first {{count}} were searched.',
    partial: '{{count}} file(s) were not searched (too large, \\u escapes, or unreadable).',
    kotlin: 'Kotlin (.kt) files are not searched.',
    unavailable: 'Fix the robot class name to find code usages. Usages by name are still searched.',
    sectionCode: 'Code',
    sectionByName: 'By name',
    byNameHint:
      'Strings that look a device up by its configuration name (hardwareMap.get, …Name(…) and the like).',
    sharedName: 'Another robot has a device with the same name; these may belong to it.',
    sameText: 'Other strings with this text ({{count}})',
    sameTextHint:
      'Strings not used to look the device up (telemetry captions and the like). Not counted.',
    descendants: '{{count}} in devices below',
    constructs: 'Created at',
    kinds: {
      field: 'Field',
      constant: 'Constant',
      type: 'Type',
      new: 'New',
      lookup: 'Name',
      text: 'Text',
      unresolved: 'Missing'
    },
    listLabel: 'Usages of {{name}}',
    fileLabel: '{{file}}, {{count}} usage(s)',
    rowLabel: '{{file}} line {{line}}, {{kind}}: {{code}}',
    openHint: 'Double-click or press Enter to open this line in the external script editor.',
    noLineHint:
      "The current external script editor can't take a line number, so only the file opens. Choose Android Studio or another editor in Preferences to open at this line.",
    more: '{{count}} more',
    renamedCode:
      "{{count}} place(s) use the old name {{old}}; they won't compile against the generated code for this scene.",
    renamedName:
      '{{count}} string(s) look up the old name "{{old}}"; with this configuration the device won\'t be found at run time.',
    unresolved: 'Names missing from the generated code ({{count}})',
    unresolvedHint:
      "Code that uses fields or types the hardware class for this scene doesn't have. It won't compile against that class.",
    unresolvedInClass: 'Names missing from this class ({{count}})',
    unknownNames: 'Device names not in the configuration ({{count}})',
    unknownNamesHint:
      "No robot in SandBot has a device with this name. Run with the generated configuration and the device won't be found."
  },
  // Preferences window (Unity's Edit > Preferences). Editor product names (Android Studio etc.) are not translated.
  preferences: {
    title: 'Preferences',
    close: 'Close',
    categories: 'Categories',
    externalTools: {
      title: 'External Tools',
      scriptEditor: 'External Script Editor',
      openByExtension: 'Open by file extension',
      browse: 'Browse…',
      browseTitle: 'Choose the External Script Editor',
      exe: 'Executable',
      args: 'External Script Editor Args',
      argsHint:
        '$(File) file path · $(Line) line · $(Column) column · $(ProjectPath) project folder. Wrap values that may contain spaces in double quotes.',
      reset: 'Reset',
      resetHint: 'Reset the arguments to the default ({{args}}).',
      systemHint: 'Opens with the app associated with .java files. Line numbers cannot be passed.',
      detectedHint:
        'An editor found on this PC. It opens with the project folder and the line number.',
      noneDetected:
        'Android Studio, IntelliJ IDEA and VS Code were not found on this PC. Choose another editor with [Browse…].',
      loading: 'Loading…',
      loadFailed: 'Could not read the external script editor setting. Close and reopen this window.'
    }
  },
  hardware: {
    // 생성 코드 경로(메커니즘 그룹 1단계)
    javaPath: 'Java field',
    javaPathHint:
      'How an OpMode reaches this device. robot is the hardware class variable ({{className}} robot = new {{className}}(hardwareMap);).',
    javaConstants: 'Java constants',
    badge: '⚙ {{count}}',
    severity: {
      error: 'Hardware error',
      warning: 'Hardware warning'
    },
    severityBelow: {
      error: 'Hardware error in a child object',
      warning: 'Hardware warning in a child object'
    },
    add: 'Add component…',
    remove: 'Remove',
    removeLabel: 'Remove {{name}}',
    orphan: 'Not part of a robot, so no code is generated.',
    deviceName: 'Device name',
    hub: 'Hub',
    hubs: {
      controlHub: 'Control Hub',
      expansionHub: 'Expansion Hub'
    },
    hubOff: '{{hub}} (off)',
    portKinds: {
      motor: 'Motor port',
      servo: 'Servo port',
      digital: 'Digital port',
      analog: 'Analog port',
      i2c: 'I2C bus',
      encoder: 'Encoder port',
      usb: 'Connection'
    },
    portUsedBy: '{{port}} · {{names}}',
    usb: 'Control Hub USB port',
    objectNone: '(none)',
    categories: {
      actuator: 'Actuators',
      sensor: 'Sensors',
      imu: 'IMU',
      odometry: 'Odometry',
      vision: 'Vision',
      other: 'Other'
    },
    types: {
      motor: 'DC motor',
      servo: 'Servo',
      crServo: 'Continuous rotation servo',
      sparkMini: 'REV SPARK Mini',
      imu: 'Hub built-in IMU',
      distanceSensor: 'Distance sensor (REV 2m)',
      colorSensor: 'Color sensor (REV V3)',
      touchSensor: 'Touch sensor (REV)',
      digitalDevice: 'Digital device',
      analogInput: 'Analog input',
      led: 'LED',
      blinkin: 'REV Blinkin LED driver',
      webcam: 'Webcam',
      limelight: 'Limelight 3A',
      huskyLens: 'HuskyLens',
      pinpoint: 'goBILDA Pinpoint',
      otos: 'SparkFun OTOS',
      octoQuad: 'OctoQuad',
      deadWheel: 'Dead wheel (odometry pod)'
    },
    props: {
      motorModel: 'Motor type',
      direction: 'Direction',
      runMode: 'Run mode',
      zeroPowerBehavior: 'Zero power',
      pulseRange: 'Pulse range',
      scaleMin: 'Scale min',
      scaleMax: 'Scale max',
      chip: 'IMU chip',
      logoFacing: 'Logo faces',
      usbFacing: 'USB faces',
      gain: 'Gain',
      mode: 'Mode',
      serialNumber: 'Serial',
      podType: 'Pod type',
      xPod: 'X pod part',
      yPod: 'Y pod part',
      xDirection: 'X encoder',
      yDirection: 'Y encoder',
      mountingAngle: 'Mounting angle (°)',
      linearScalar: 'Linear scalar',
      angularScalar: 'Angular scalar',
      measures: 'Measures',
      reversed: 'Encoder reversed'
    },
    options: {
      motorModel: {
        goBilda5202: 'goBILDA 5202/5203/5204',
        goBilda5201: 'goBILDA 5201',
        revHdHex20: 'REV HD Hex 20:1',
        revHdHex40: 'REV HD Hex 40:1',
        revUltraPlanetary: 'REV UltraPlanetary',
        revCoreHex: 'REV Core Hex',
        neverest20: 'NeveRest 20',
        neverest40: 'NeveRest 40',
        neverest60: 'NeveRest 60',
        tetrix: 'TETRIX',
        matrix12v: 'MATRIX 12V',
        studicaMaverick: 'Studica Maverick',
        unspecified: 'Unspecified (generic motor)'
      },
      direction: {
        forward: 'Forward (FORWARD)',
        reverse: 'Reverse (REVERSE)'
      },
      runMode: {
        withoutEncoder: 'Without encoder',
        usingEncoder: 'Using encoder',
        resetThenUsingEncoder: 'Reset, then using encoder'
      },
      zeroPowerBehavior: {
        brake: 'Brake (BRAKE)',
        float: 'Coast (FLOAT)'
      },
      pulseRange: {
        standard: 'Standard (600–2400 µs)',
        fullRange: 'Full (500–2500 µs)'
      },
      chip: {
        bhi260ap: 'BHI260AP (Control Hub since Sep 2022)',
        bno055: 'BNO055 (older hubs)'
      },
      hubDirection: {
        up: 'Up',
        down: 'Down',
        forward: 'Forward',
        backward: 'Backward',
        left: 'Left',
        right: 'Right'
      },
      mode: {
        input: 'Input',
        output: 'Output'
      },
      podType: {
        fourBar: '4-Bar pod',
        swingarm: 'Swingarm pod'
      },
      encoderDirection: {
        forward: 'Forward',
        reversed: 'Reversed'
      },
      measures: {
        forward: 'Forward/back (parallel pod)',
        strafe: 'Left/right (perpendicular pod)'
      },
      reversed: {
        no: 'No',
        yes: 'Yes'
      }
    },
    hints: {
      imu: 'Choose which way the REV logo and the USB ports of the hub face on the robot. In the scene, the purple arrow shows the logo direction and the orange arrow the USB direction.',
      webcam:
        'Enter the USB serial shown when you scan in Configure Robot on the Driver Station. Left empty, the webcam is not put in the configuration XML.',
      limelight:
        'Enter the serial from the Driver Station scan, in the form EthernetOverUsb:<interface>:<IP>.',
      pinpoint:
        'The X pod measures forward/back motion and the Y pod left/right. Offsets come from the chosen parts.',
      otos: "The offset position comes from this part's position. The heading is the angle the sensor's arrow is turned from the robot's front (mounting angle, CCW +).",
      deadWheel:
        'The position comes from this part. If a motor uses the motor port with the same number, the encoder is read through that motor.'
    },
    derived: {
      pinpoint: 'Offsets: X {{x}} mm, Y {{y}} mm',
      otos: 'Offset: X {{x}} in, Y {{y}} in, H {{h}}°',
      deadWheel: 'Position: X {{x}} mm, Y {{y}} mm'
    },
    robot: {
      title: 'Robot hardware',
      className: 'Class name',
      configName: 'Config name',
      expansionHub: 'Expansion Hub',
      expansionHubEnabled: 'Use',
      address: 'Address',
      noComponents:
        'Attach hardware components to parts, and saving creates a hardware class and a robot configuration XML in TeamCode.',
      files: 'Generated files (TeamCode)',
      usage: 'Use in an OpMode',
      componentCount: '{{count}} component(s)',
      issues: 'Problems ({{count}})'
    },
    generation: {
      notSaved: 'Generated when you save (Ctrl+S).',
      blocked:
        'Last save: no files were generated because the project has {{count}} hardware error(s).',
      failed: 'Last save: could not write files ({{detail}}).',
      noTeamCode: 'Last save: there is no TeamCode folder.',
      deleted: 'Old generated files deleted on the last save: {{files}}',
      fileStates: {
        written: 'Written',
        unchanged: 'Unchanged',
        skipped: 'Skipped: a hand-written file exists',
        modified: 'Not overwritten: edited by hand',
        missing: 'Not generated yet'
      }
    },
    issues: {
      emptyName: 'The device name is empty.',
      nameWhitespace:
        '"{{name}}" has leading or trailing spaces. It may not match the name on the Driver Station.',
      duplicateName: 'The device name "{{name}}" is used more than once.',
      fieldNameCollision: '{{names}} all become the Java field {{field}}.',
      portOutOfRange: '{{name}}: port {{port}} is out of range (0–{{max}}).',
      portConflict: 'Port {{port}} is shared by {{names}}.',
      i2cAddressConflict:
        '{{names}} have the same address on I2C bus {{bus}}. Put them on different buses.',
      imuOrientationInvalid: '{{name}}: the logo and USB directions must be perpendicular.',
      touchSensorEvenChannel:
        '{{name}}: the REV touch sensor works on odd digital channels (1, 3, 5, 7).',
      encoderMotorConflict:
        '{{name}}: motor {{motor}} on the same port {{port}} uses its encoder. Set that motor\'s run mode to "Without encoder".',
      deadWheelSlowPort:
        '{{name}}: encoder port {{port}} can miss counts at high speed. Put forward/back pods on port 0 or 3.',
      expansionHubDisabled:
        '{{name}} is on the Expansion Hub, which is turned off. Turn it on under Robot hardware.',
      serialMissing:
        '{{name}}: no serial, so it is left out of the configuration XML and this field of the hardware class is null.',
      limelightSerialInvalid:
        '{{name}}: the serial is not in the form EthernetOverUsb:<interface>:<IP>.',
      pinpointPodMissing:
        '{{name}}: choose the X and Y pod parts on this robot. Until then the offsets are generated as 0.',
      orphanComponent:
        '{{name}}: attached to an object outside any robot, so no code is generated.',
      invalidClassName: '"{{className}}" cannot be used as a Java class name.',
      duplicateClassName: 'The generated file name clashes with another robot ({{className}}).',
      emptyConfigName: 'The robot configuration name is empty.',
      duplicateConfigName: 'The configuration name "{{configName}}" is also used by another robot.',
      expansionHubAddressReserved:
        'Expansion Hub address {{address}} is in the range the SDK reserves for system use (usually 1–10). Check that it matches the hub.',
      servoScaleInvalid:
        '{{name}}: scale min must be less than scale max. To run the servo the other way, change its direction.',
      imuChipHub:
        "{{name}}: an Expansion Hub's built-in IMU is a BNO055. Set the IMU chip to BNO055.",
      constantNameCollision:
        '{{names}} produce the same constant {{constant}}. Rename one of them.',
      expansionHubAddressInvalid:
        'Expansion Hub address {{address}} cannot be used (1–254, except 173).',
      invalidGroupName:
        'Group "{{name}}": "{{className}}" cannot be a Java class name. The group\'s hierarchy name becomes a class in the generated code, so use English letters and digits starting with a capital letter. To keep the name, set a "Java class name" in the group\'s inspector.',
      reservedGroupName:
        'Group "{{name}}": the class name {{className}} is a Java type the generated code uses. Choose another name.',
      duplicateGroupClass:
        '{{names}}: the Java class name {{className}} clashes. Groups in the same class must differ by more than letter case, and a group cannot share its name with a class that contains it (including the robot class).',
      reservedFileName:
        'The class name {{className}} is a Windows device name, so it cannot be a file name ({{className}}.java). Choose another name.'
    }
  }
}

export default en
