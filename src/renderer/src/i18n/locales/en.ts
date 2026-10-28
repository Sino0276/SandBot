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
    preferencesTooltip: 'Preferences (external script editor, JDK, simulation)'
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
    pasteRejectedRobot:
      'A robot cannot be pasted under another object. Robots can only be reordered.',
    pasteRejectedCadRoot:
      "A CAD root can only be reordered within its robot (the CAD root's transform is the CAD alignment).",
    pasteRejectedOtherRobot:
      'Objects cannot move to another robot. Paste them within the same robot.',
    pasteRejectedDescendant: 'Objects cannot be pasted under themselves or their children.',
    pasteRejectedMissing: 'There is nothing to paste or nowhere to paste it.',
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
      '{{file}} is no longer a regular file inside TeamCode/src/main/java (for example, a link pointing outside), so its tunables were discarded without being written: {{fields}}',
    // Play (sidecar phase 1): why playInit refused. {{detail}} is the main process's English sentence.
    playNotAllowed: 'This project cannot be run ({{detail}}). Try reopening the project.',
    playMissing:
      'The OpMode file or the TeamCode folder was not found, so nothing was run ({{detail}}). The OpMode list was reloaded.',
    playNoJdk:
      'There is no JDK to run with. The JDK folder chosen in Preferences can no longer be used, or no JDK 17 or later was found on this PC (one bundled with Android Studio is found automatically).',
    playNoSidecar:
      'The runner (sidecar) has not been built. During development, run pnpm build:sidecar and INIT again.',
    playBusy: 'The previous run has not finished yet. INIT again in a moment.',
    playFailed: 'Could not start the JVM ({{detail}}).',
    playInitFailed: 'Could not start the run ({{detail}}).'
  },
  // Notice action buttons
  noticeAction: {
    openJdkPreferences: 'Open JDK settings'
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
    inspector: 'Inspector',
    // Tabs of the panel below the Scene view (Unity's Console spot)
    dock: 'Console, Telemetry, Devices',
    console: 'Console',
    telemetry: 'Telemetry',
    devices: 'Devices'
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
    local: 'Local',
    isolation: 'Isolation view: only the selected objects are shown',
    exitIsolation: 'Exit ({{shortcut}})',
    // Keyboard gamepad while running (only while the scene view has focus)
    keyboardPad: {
      active: 'Keyboard → gamepad {{slot}}',
      inactive: 'Click the scene view: keyboard → gamepad {{slot}}',
      helpTitle: 'Keyboard gamepad layout',
      layout: {
        leftStick: { keys: 'W A S D', field: 'Left stick' },
        rightStick: { keys: '↑ ← ↓ →', field: 'Right stick' },
        buttons: { keys: 'I J K L', field: 'Y X A B (pad shape)' },
        bumpers: { keys: 'U O', field: 'Left · right bumper' },
        triggers: { keys: 'Q E', field: 'Left · right trigger' },
        dpad: { keys: 'T F G H', field: 'D-pad up · left · down · right' },
        startBack: { keys: 'Enter · Backspace', field: 'start · back' }
      },
      hint: 'While the scene view has focus, editing shortcuts (F, Q/W/E, H, Delete and so on) are off. Ctrl combinations (save, undo, Ctrl+P) still work. Clicking elsewhere releases every key.'
    }
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
    search: 'Search hierarchy',
    searchPlaceholder: 'Search ({{shortcut}})',
    searchClear: 'Clear search',
    searchNoResults: 'No objects match "{{query}}"',
    hide: 'Hide in Scene view',
    show: 'Show in Scene view',
    visibilityTitle: '{{action}} (H, Alt+click for this object only)',
    cutTitle: 'Cut: select a row and press {{paste}} (next sibling) or {{child}} (child)',
    menu: {
      label: 'Hierarchy menu',
      cut: 'Cut',
      paste: 'Paste',
      pasteAsChild: 'Paste As Child',
      selectChildren: 'Select Children',
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
    running: 'Running',
    runningHint:
      'While running, the position and rotation of this robot and its children cannot be edited. The scene view draws the simulator pose and returns to the edit position when the run ends (the values do not change).',
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
    samePortName:
      'The motor and dead wheel on this port share this configuration name; these may belong to the other one.',
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
    fileLabelAtLeast: '{{file}}, {{count}}+ usages',
    fileCountAtLeast: '{{count}}+',
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
    },
    // JDK field of External Tools (like Unity's JDK setting). Used to run the sidecar.
    jdk: {
      title: 'JDK',
      label: 'JDK for running',
      auto: 'Automatic (recommended)',
      browse: 'Browse…',
      browseTitle: 'Choose a JDK folder',
      option: 'JDK {{version}} · {{source}} — {{home}}',
      optionTooOld: 'JDK {{version}} · {{source}} — {{home}} (older than {{min}}, cannot be used)',
      sources: {
        setting: 'Chosen',
        androidStudio: 'Android Studio',
        javaHome: 'JAVA_HOME',
        path: 'PATH'
      },
      errors: {
        notJdk:
          'The chosen folder is not a JDK (no bin/java, bin/javac or release file; it may be a JRE). The setting was not changed.',
        tooOld:
          'The chosen JDK is older than {{min}} and cannot be used. The setting was not changed.'
      },
      applyFailed: 'Could not change the JDK setting ({{detail}}).',
      active: 'In use',
      activeValue: 'JDK {{version}} ({{source}}) {{home}}',
      none: 'No JDK was found. If Android Studio is installed it is found automatically. JDK {{min}} or later is required.',
      customMissing:
        'The chosen JDK folder can no longer be used (deleted or moved). Switch to Automatic or choose again. JDK {{min}} or later is required.',
      hint: 'Automatic looks for the JDK bundled with Android Studio (jbr), then JAVA_HOME, then PATH. JDK {{min}} or later is required.',
      loading: 'Looking for JDKs…',
      loadFailed: 'Could not look for JDKs ({{detail}}). Close and reopen this window.'
    },
    // Simulation (personal settings, used from the next INIT)
    simulation: {
      title: 'Simulation',
      jitter: 'Hub timing jitter',
      jitterOff: 'Off (always the same result)',
      jitterValue: '±{{percent}}%',
      jitterHint:
        'Each hardware call advances virtual time by the Hub timing table. With jitter on, each cost is drawn uniformly within the range so loop times vary a little like a real hub. The same seed gives the same result.',
      seed: 'Seed',
      seedHint:
        'The order the jitter is drawn in (an integer). Same code, inputs and seed give the same result.',
      autoStop: 'Stop Autonomous automatically {{seconds}} s after START (like the Driver Station)',
      battery: 'Battery voltage',
      batteryUnit: 'V',
      batteryHint:
        'Battery voltage of the simulator ({{min}}–{{max}} V). Motor free speed scales with voltage ÷ 12, and the hub getVoltage() returns this value.',
      nextRun: 'Changes apply from the next INIT. The run speed is set in the toolbar.'
    }
  },
  // Play (sidecar phase 1): toolbar OpMode picker, INIT/START/STOP, pause, step, speed, virtual time.
  // INIT, START and STOP are the Driver Station button names.
  play: {
    controls: 'Play',
    opMode: 'OpMode',
    opModeList: 'OpModes',
    chooseOpMode: 'Choose OpMode',
    chooseOpModeTooltip: 'Choose the OpMode to run (the Driver Station OpMode list)',
    noOpModes: 'No OpModes',
    noProjectShort: 'OpMode',
    opModeTooltip: '{{flavor}} · {{name}}\n{{className}} ({{file}})',
    flavors: {
      TeleOp: 'TeleOp',
      Autonomous: 'Autonomous'
    },
    flavorShort: {
      TeleOp: 'TeleOp',
      Autonomous: 'Auto'
    },
    list: {
      loading: 'Looking for OpModes…',
      failed: 'Could not read the OpMode list ({{detail}}).',
      noTeamCode: 'The project has no TeamCode folder.',
      empty: 'TeamCode has no @TeleOp or @Autonomous OpModes (@Disabled ones are not shown).',
      truncated: 'TeamCode has too many files; only some OpModes are shown.'
    },
    init: 'INIT',
    start: 'START',
    stop: 'STOP',
    initTooltip: 'INIT: compile the saved TeamCode and initialize the OpMode ({{shortcut}})',
    startTooltip: 'START ({{shortcut}})',
    stopTooltip: 'STOP ({{shortcut}})',
    stoppingTooltip: 'Stopping…',
    stopInit: 'STOP without START',
    stopInitTooltip: 'STOP without START',
    pause: 'Pause',
    pauseTooltip: 'Pause ({{shortcut}}). Turn it on before running to stop right after INIT.',
    step: 'Step',
    stepTooltip: 'Step: while paused, advance one loop ({{shortcut}})',
    speed: 'Run speed',
    speedTooltip:
      'Run speed (virtual time ÷ real time). Max runs as fast as possible without waiting. The result is the same at any speed.',
    speedMax: 'Max',
    speedValue: '{{speed}}×',
    timeTooltip: 'Virtual time {{time}} (the time team code sees)',
    autonomousTooltip: 'Autonomous time left · virtual time {{time}}',
    timeIdleTooltip: 'Virtual time (advances while running)',
    phase: {
      preparing: 'Preparing…',
      compiling: 'Compiling…',
      init: 'INIT',
      running: 'Running',
      stopping: 'Stopping…',
      finished: 'Finished'
    },
    slow: 'Slow {{ratio}}×',
    slowTooltip:
      'This PC cannot keep up with the chosen speed ({{speed}}×) and is actually running at {{ratio}}×. Results in virtual time are the same.',
    // Why INIT cannot be pressed (button tooltip)
    disabled: {
      noProject: 'Open or save an FtcRobotController project to run its TeamCode OpModes.',
      noTeamCode: 'The project has no TeamCode folder, so nothing can be run.',
      noOpMode: 'Choose an OpMode to run.',
      busy: 'A project is being opened or saved.',
      running: 'Running.'
    },
    saveBeforeRun:
      'You have unsaved changes. Running uses the TeamCode and the generated robot configuration on disk, so they must be saved first. Save and run?',
    saveAndRun: 'Save and run',
    // Prefix of sidecar errors (followed by the English original)
    errorKind: {
      exception: 'Exception',
      unsupported: 'Unsupported SDK feature',
      thread: 'Called from another thread',
      stall: 'Not responding',
      stuckInStop: 'Did not finish after STOP',
      load: 'Could not load the OpMode',
      config: 'Robot configuration error',
      internal: 'Sidecar internal error'
    },
    stallHint:
      'This may be an infinite loop. Put opModeIsActive() in the while condition and make sure the loop uses hardware or calls sleep or idle() (virtual time only advances through SDK calls). Pressing STOP ends the JVM.',
    finishReason: {
      stopped: 'Stopped with STOP',
      returned: 'The OpMode ended by itself',
      terminated: 'Terminated (terminateOpModeNow or System.exit)',
      exception: 'Ended with an error',
      compileFailed: 'Compile error',
      loadFailed: 'Could not load the OpMode or the robot configuration',
      stuck: 'Gave up: did not finish after STOP',
      shutdown: 'Shut down',
      killed: 'The JVM was killed',
      crashed: 'The runner exited unexpectedly'
    },
    // detail of finished killed (why the main process ended the JVM)
    killedDetail: {
      stopTimeout: 'The JVM was ended because it did not finish within 5 seconds after STOP.',
      stalled:
        'STOP was pressed on an OpMode that was not responding (possibly an infinite loop), so the JVM was ended right away.',
      shutdownTimeout: 'The JVM was ended because it did not finish while shutting down.'
    },
    gamepad: {
      disconnected: 'Gamepad {{slot}}: not connected',
      connected: 'Gamepad {{slot}}: {{id}}',
      nonStandard: 'Gamepad {{slot}}: {{id}} (not a standard layout; no input is sent)',
      keyboard: 'Gamepad {{slot}}: keyboard (click the scene view while running to use it)',
      hint: 'Read only while running. Press a button once after connecting to make it visible. The first and second connected pads are gamepad1 and gamepad2, and the keyboard takes the first slot without a pad when the run starts (slots do not change during a run, so press a pad button before INIT).'
    }
  },
  // Console (Unity Console). English sentences from team code and javac are shown as they are.
  console: {
    clear: 'Clear',
    clearOnPlay: 'Clear on Play',
    clearOnPlayHint: 'Clear the Console every time you INIT.',
    search: 'Search Console',
    levels: 'Shown entries',
    levelToggle: {
      info: 'Show or hide {{count}} log(s)',
      warning: 'Show or hide {{count}} warning(s)',
      error: 'Show or hide {{count}} error(s)'
    },
    list: 'Console entries',
    empty:
      'No logs. When an OpMode runs, System.out and RobotLog output, compile errors and run errors appear here.',
    noMatch: 'Nothing matches the search or the shown entries.',
    noSelection: 'Select an entry to see its full text and stack.',
    openHint: 'Double-click or press Enter to open this line in the external script editor.',
    openLink: 'Click to open this line in the external script editor.',
    diagnosticKind: {
      error: 'error',
      warning: 'warning',
      note: 'note'
    },
    compiled: 'Compiled ({{millis}} ms)',
    compiledWithWarnings: 'Compiled with {{count}} warning(s) ({{millis}} ms)',
    compileFailed:
      '{{count}} compile error(s) ({{millis}} ms). Double-click an entry to open its line.',
    runStarted: '{{name}} INIT · robot configuration {{config}}',
    runStartedNoConfig: '{{name}} INIT · no robot has hardware, running with an empty hardwareMap',
    finished: 'OpMode finished: {{reason}}',
    exception: 'Exception class',
    thread: 'Thread',
    code: 'Diagnostic code',
    // Notes left by the run flow
    notices: {
      // Warnings left while building the kinematic simulator's world description (play/worldSpec.ts) at INIT
      worldNoWheels:
        'The robot has no wheel components, so it will not move. Add [Add component → Wheel] to the wheel parts (or groups).',
      worldWheelNoMotor: 'Wheel {{name}} has no drive motor, so it only rolls along.',
      worldWheelMotorMissing:
        'The drive motor of wheel {{name}} is not in this robot (deleted or on another robot), so the wheel is not driven.',
      worldRollersAmbiguous:
        'The roller type of mecanum wheel {{name}} cannot be told from its position, so it is treated as front-left/back-right. Choose the rollers in the wheel card.',
      worldSharedEncoder:
        'Dead wheel {{deadWheel}} shares its encoder port with motor {{motor}}, whose run mode uses the encoder. On the robot the pod encoder controls it, but the simulator assumes the motor shaft encoder does.',
      worldDuplicateMotor:
        'The motor device name {{name}} is empty or used twice, so the simulator does not use that motor.',
      // One sentence per list over its limit (worldSpec.ts capped)
      worldTooManyMotors:
        'There are more motors than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyWheels:
        'There are more wheels than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyDeadWheels:
        'There are more dead wheels than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyPinpoints:
        'There are more Pinpoints than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyOtos:
        'There are more OTOS sensors than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyImus:
        'There are more IMUs than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldGenerationStale:
        'Device names may differ from the generated configuration, so the wheels may not move.',
      worldInvalid: 'Could not build the simulator world, so the robot will not move ({{detail}}).',
      generationBlocked:
        'The last save did not generate code because of {{count}} hardware error(s). Running with the previous hardware class and configuration left in TeamCode.',
      generationFailed:
        'The last save could not write the generated code ({{detail}}). The hardware class and configuration in TeamCode may differ from the scene.',
      configNotGenerated:
        '{{file}} was edited by the team or made by hand, so SandBot did not overwrite it. Running with the configuration in that file.',
      configMissing:
        'The robot configuration {{file}} is not in TeamCode, so the run uses an empty hardwareMap. Saving the project generates it.',
      // Simulator notices (simNotice, SimNoticeCode)
      sim: {
        sharedEncoderMode:
          'The motor {{device}} runs in an encoder mode (RUN_USING_ENCODER or RUN_TO_POSITION). A dead wheel shares its port, so on the real robot it is controlled by the pod encoder, but the simulator assumes the motor shaft encoder.',
        worldError:
          'The simulator failed while computing and keeps sending the previous sensor values ({{detail}}).'
      }
    }
  },
  // Telemetry tab (like the Driver Station screen)
  telemetry: {
    noRun: 'Run an OpMode to see telemetry like on the Driver Station.',
    empty: 'No telemetry received yet (it appears when telemetry.update() sends).',
    log: 'Telemetry log',
    sentAt: 'Virtual time sent'
  },
  // Devices tab (device output table)
  devices: {
    noRun: 'Run an OpMode to see device outputs (motor power, servo position and so on).',
    noConfig: 'No robot has hardware, so it ran without devices.',
    empty: 'No device outputs received yet.',
    name: 'Name',
    type: 'Type',
    values: 'Outputs',
    inputs: 'Sensor values',
    inputsHint:
      'Raw hub values sent by the simulator (encoder ticks, IMU angles and so on). Team code reads them after the SDK applies direction and units.',
    selectHint: 'Click to select {{name}}.'
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
    // Simulator-only properties (not in the generated code)
    simulationOnly:
      'Simulator-only setting (not written to the generated code or configuration XML).',
    gearboxModelDefault: 'Model default',
    gearboxReset: 'Model default',
    gearboxResetHint: 'Go back to the SDK gear ratio of the motor type.',
    // Wheel (simulator setting, attached to wheel parts like a Unity WheelCollider)
    wheel: {
      addGroup: 'Simulation',
      addOption: 'Wheel',
      title: 'Wheel',
      kind: 'Type',
      kinds: {
        mecanum: 'Mecanum',
        omni: 'Omni',
        traction: 'Traction'
      },
      diameter: 'Diameter',
      fitSize: 'From part size',
      fitSizeHint:
        "Uses the height (size along the robot's up axis) of the bounding box of this object (its child parts for a group) as the diameter. A wheel's axle is horizontal, so its height is the diameter whichever way it faces (such as a 45° omni wheel in an X-drive).",
      fitSizeNone: 'There is no shape to measure.',
      motor: 'Drive motor',
      motorNone: '(none: rolls along)',
      motorMissing: '(motor not found)',
      gearRatio: 'External ratio',
      gearRatioHint: 'Reduction from the motor output shaft to the wheel (1 when direct).',
      angle: 'Rolling direction (°)',
      angleHint:
        'The direction the wheel pushes when it rolls forward. 0° is the robot front (+X), counterclockwise is +. Independent of the CAD part rotation.',
      rollers: 'Rollers',
      rollerOptions: {
        auto: 'Auto',
        flbr: 'Front-left/back-right type',
        frbl: 'Front-right/back-left type'
      },
      rollersAuto: 'Auto ({{type}})',
      rollersHint:
        'In the standard layout where the rollers form an X seen from above, the wheels at the front-left and back-right are the front-left/back-right type. Auto uses the quadrant around the center of the mecanum wheels.',
      topSpeed: 'Top speed ≈ {{speed}} {{unit}}/s (free, {{volts}} V)',
      topSpeedNoMotor: 'Choose a drive motor to see the top speed.',
      motorMissingWarning:
        'The drive motor is not in this robot (deleted or on another robot). The wheel is not driven when running.',
      rollersAmbiguousWarning:
        'The roller type cannot be told from the position (on a center line of the mecanum wheels, or not rolling forward/backward), so it is treated as front-left/back-right. Choose the rollers.',
      orphan: 'This object is not in a robot, so the simulator does not use it.',
      hint: 'A wheel is a simulator setting. It is independent of the generated code and configuration XML, and its position comes from this object (the center of its child parts for a group). The drive motor direction (inspector) is taken as the one where +power rolls this wheel forward.'
    },
    // Drivetrain summary in the robot card
    drivetrain: {
      title: 'Drivetrain (simulator)',
      summary: '{{count}} wheel(s) · {{kinds}}',
      kindCount: '{{kind}} {{count}}',
      none: 'No wheels. Add [Add component → Wheel] to the wheel parts to make the robot move when running.'
    },
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
      reversed: 'Encoder reversed',
      gearbox: 'Gearbox ratio',
      podDiameter: 'Pod wheel diameter',
      podCpr: 'Encoder CPR'
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
        swingarm: 'Swingarm pod',
        revThroughBore: 'REV Through Bore (8192 CPR)',
        custom: 'Custom'
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
      deadWheel: 'Position: X {{x}} mm, Y {{y}} mm',
      motorOutput: 'Output shaft {{rpm}} RPM (free, 12 V) · {{ticks}} ticks/rev',
      deadWheelPod: 'Pod resolution: {{ticks}} ticks/mm'
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
