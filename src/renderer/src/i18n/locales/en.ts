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
    // Field (season) notices
    fieldStartOverlap: 'The start pose overlaps field elements: {{robots}}',
    fieldUnknownSeason:
      'This project uses an unknown field season "{{season}}". It is shown and simulated as the nominal 12 ft field; saving keeps the season string.',
    fieldAssumedSeason:
      'This project predates field settings, so it was opened with the BIOBUZZ field. You can change it in Field.',
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
    // The Console's Road Runner tuning result entry could not be shown in the file manager (a simulated storage file)
    simFileMissing: 'Could not find {{fileName}}. It may have been deleted or moved.',
    simFileRevealFailed: 'Could not show {{fileName}} in the file manager ({{detail}}).',
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
    playFailed: 'Could not start the run ({{detail}}).',
    playInitFailed: 'Could not start the run ({{detail}}).',
    playNoAndroidSdk:
      "There is no usable Android SDK. The SDK folder chosen in Preferences can no longer be used (deleted or moved), or no SDK was found where Automatic looks (sdk.dir in the project's local.properties, ANDROID_HOME, ANDROID_SDK_ROOT, the default location). Team code is compiled against the project compileSdk Android API, as in Android Studio, so an Android SDK is required. Choose the SDK folder in Preferences (if the chosen folder can no longer be used, choose it again or switch to Automatic).",
    playNoAndroidPlatform:
      'The Android SDK does not have this project platform ({{detail}}). Install it with the SDK Manager in Android Studio, then INIT again.',
    playCancelled: 'The library download was cancelled, so the run did not start.',
    libraryResolving: 'Checking library dependencies ({{done}} files, {{size}})',
    libraryDownloading: 'Downloading libraries ({{done}}/{{total}}, {{size}})'
  },
  // Notice action buttons
  noticeAction: {
    selectRobot: 'Select robot',
    showField: 'Show Field',
    openJdkPreferences: 'Open JDK settings',
    openAndroidSdkPreferences: 'Open Android SDK settings'
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
    massSymbols: {
      g: 'g',
      kg: 'kg',
      lb: 'lb',
      oz: 'oz'
    },
    names: {
      mm: 'mm (millimeters)',
      cm: 'cm (centimeters)',
      m: 'm (meters)',
      in: 'in (inches)'
    },
    lengthInputHint:
      'You can type a unit (e.g. 12in, 30cm, 150mm). Without one, the value is read in {{unit}}.',
    angleRejected: 'Not an angle. Enter a number in degrees (°) or add rad. Press Esc to revert.',
    angleInputHint: 'Degrees (°). Add rad to enter radians.'
  },
  panels: {
    hierarchy: 'Hierarchy',
    scene: 'Scene',
    inspector: 'Inspector',
    // Tabs of the panel below the Scene view (Unity's Console spot)
    dock: 'Console, Telemetry, Devices, Config',
    console: 'Console',
    telemetry: 'Telemetry',
    devices: 'Devices',
    // Edit @Config values during a run, like the FTC Dashboard Configuration panel
    config: 'Config'
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
    // Field row at the top (season field, where Unity shows the scene header)
    fieldRow: 'Field — {{season}}',
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
    // Start position of a top-level robot (snap to the wall with the season's G304 start presets)
    startPreset: 'Start position',
    startPresetNone: '—',
    startPresetTooWide:
      'The outline is {{width}} wide, wider than the span ({{available}}), so {{count}} presets are unavailable.',
    startPresetConflict:
      'Snapping would overlap {{targets}}, so {{count}} presets are unavailable.',
    startFacing: {
      label: 'Side facing the wall',
      default: 'Default (front toward the field)',
      reverse: 'Reversed (back toward the field)',
      left: 'Left side toward the field',
      right: 'Right side toward the field'
    },
    startOutline: 'Outline {{width}} × {{depth}}',
    // Alliance groups in the start position list
    startAlliance: { red: 'Red', blue: 'Blue' },
    startOversize:
      'Outline {{width}} × {{depth}}: over 18 in (R102). The outline is the CAD bounding box and may be larger than the robot.',
    collisionHeight: 'Collision height {{height}}',
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
    // The Android SDK that team code is compiled against (the Java API of the project's compileSdk platform)
    androidSdk: {
      title: 'Android SDK',
      label: 'Android SDK for compiling',
      auto: 'Automatic (recommended)',
      browse: 'Browse…',
      browseTitle: 'Choose an Android SDK folder',
      option: '{{source}} — {{home}} ({{platforms}})',
      sources: {
        setting: 'Chosen',
        localProperties: 'local.properties',
        env: 'Environment variable',
        default: 'Default location'
      },
      errors: {
        notSdk:
          'The chosen folder is not an Android SDK (no platforms folder). The setting was not changed.'
      },
      applyFailed: 'Could not change the Android SDK setting ({{detail}}).',
      active: 'In use',
      activeValue: '{{home}} ({{source}})',
      platforms: 'Installed platforms',
      noPlatforms: 'no platforms',
      none: 'No Android SDK was found. If Android Studio is installed it is found automatically.',
      customMissing:
        'The chosen Android SDK folder can no longer be used (deleted or moved). Switch to Automatic or choose again.',
      hint: "Like Android Studio, team code is compiled against the Java API of the project's compileSdk platform (install missing platforms with Android Studio's SDK Manager). Automatic looks at sdk.dir in the project's local.properties, then ANDROID_HOME and ANDROID_SDK_ROOT, then the default location.",
      loading: 'Looking for Android SDKs…',
      loadFailed: 'Could not look for Android SDKs ({{detail}}). Close and reopen this window.'
    },
    // Simulation (personal settings, used from the next INIT)
    simulation: {
      hiveState: 'HIVE state',
      hiveRed: 'Red HIVE',
      hiveBlue: 'Blue HIVE',
      hiveStart: 'Start',
      hiveTipped: 'Tipped',
      hiveHint:
        'A personal run setting. It is not saved in the project, and the simulator uses it from the next INIT. Same value as in the Field inspector.',
      title: 'Simulation',
      jitter: 'Hub timing jitter',
      jitterOff: 'Off (always the same result)',
      jitterValue: '±{{percent}}%',
      jitterHint:
        'Each hardware call advances virtual time by the Hub timing table. With jitter on, each cost is drawn uniformly within the range so loop times vary a little like a real hub. The same seed gives the same result.',
      seed: 'Seed',
      seedHint:
        'The order the jitter and sensor noise are drawn in (an integer). Same code, inputs and seed give the same result.',
      autoStop: 'Stop Autonomous automatically {{seconds}} s after START (like the Driver Station)',
      battery: 'Battery voltage',
      batteryUnit: 'V',
      batteryHint:
        'Battery voltage of the simulator ({{min}}–{{max}} V). Motor free speed scales with voltage ÷ 12, and the hub getVoltage() returns this value.',
      sensorNoise: 'Sensor noise',
      sensorNoiseHint:
        'Adds a fixed per-device offset (±10 mm) and per-measurement noise (datasheet spread) to distance sensor values. Color sensors get no noise. The same seed gives the same values.',
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
      truncated: 'TeamCode has too many files; only some OpModes are shown.',
      // OpModes registered by @OpModeRegistrar (the sidecar runs the registrars to read them)
      registeredLoading: 'Reading registrar (@OpModeRegistrar) OpModes…',
      registeredFailed: 'Could not read the registrar OpModes: {{reason}}',
      registeredCompile:
        'The registrar files did not compile ({{count}} errors), so registrar OpModes are not shown. You can open the lines from the Console.',
      registeredRegistrar:
        'The registrar {{names}} threw an exception, so its OpModes are missing (see the Console).',
      // Failure reasons of ListRegisteredResult
      registeredFailure: {
        notAllowed: 'this project cannot run',
        missing: 'TeamCode or a registrar file was not found',
        noJdk: 'no JDK 17 or newer was found (Preferences > External Tools)',
        noSidecar: 'the runner (sidecar) is not built',
        failed: 'runner error',
        noAndroidSdk: 'no Android SDK was found (Preferences > External Tools)',
        noAndroidPlatform: "the project's Android platform is not installed"
      },
      // The project's code is not trusted yet (the registrars did not run). Choosing it asks (play.codeTrust).
      registeredConsent: 'Read registrar OpModes…',
      registeredConsentHint: "Runs the project's Java code (@OpModeRegistrar) on this PC",
      registeredTag: 'Registrar',
      registeredTooltip: '{{className}} · registrar {{registrar}}\n{{file}}',
      open: 'Open',
      openTooltip: "Open this OpMode's source in the external script editor (Alt+Enter)",
      openRegistrarTooltip:
        'Open the registrar line that registers this OpMode in the external script editor (Alt+Enter)'
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
    // Asked once before reading the registrar OpModes (like Android Studio's Trust Project). Remembered per project.
    codeTrust: {
      message:
        'To list the registrar OpModes, SandBot compiles and runs the @OpModeRegistrar code of the project {{project}} (and the static initializers of the classes it touches) on this PC. INIT runs the same code, and it can access the files and network of this PC. Only do this for projects you trust. SandBot remembers this choice for this project.',
      confirm: 'Run and remember'
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
      registrar: 'OpMode registrar error',
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
      listed: 'Read the registered OpModes',
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
    // The Road Runner tuning result entry (simNotice rrTuningSaved): show it in the file manager
    revealFile: 'Show in folder',
    revealHint: 'Double-click or press Enter to show this file in the file manager.',
    rrTuningHint:
      "A Road Runner tuning OpMode wrote this result to SandBot's simulated storage (where the robot's /sdcard/FIRST would be). SandBot does not serve the Road Runner regression web pages. A robot running Road Runner serves them (the page for this kind of result under http://192.168.43.1:8080/tuning/): connect to the robot and choose this file with [Browse] to see the plot and the fitted values. The values come from SandBot's simulator and do not replace tuning on the real robot.",
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
      // Field (season) warnings (INIT)
      worldStartOverlap:
        'The start pose overlaps field elements ({{targets}}). The robot is not pushed out; if it overlaps deeply it may escape or pass through.',
      worldUnknownSeason: 'Unknown field season "{{season}}"; simulating the nominal 12 ft field.',
      // Warnings left while building the kinematic simulator's world description (play/worldSpec.ts) at INIT
      worldNoWheels:
        'The robot has no wheel components, so it will not move. Add [Add component → Wheel] to the wheel parts (or groups).',
      worldWheelNoMotor: 'Wheel {{name}} has no drive motor, so it only rolls along.',
      worldFewWheels:
        'The wheel contacts are fewer than three or lie on one line, so the robot weight cannot be split between the wheels. The simulator treats the robot as never tipping over.',
      worldChassisMass:
        'The robot body (mass without the joint bodies) is only {{mass}} kg, so the default mass of {{fallback}} kg is used. Enter the weighed mass in the Rigidbody card.',
      worldChassisMassPending:
        'The robot body still has {{count}} mesh(es) loading or not loaded, so its mass, center of mass and inertia are computed without them. The robot may accelerate and brake differently from the real one.',
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
      worldTooManyJoints:
        'There are more joints than the simulator limit ({{max}}); only the first {{max}} in hierarchy order are used. The rest move with their outer joint.',
      // Joints (3b, play/worldJoints.ts)
      worldJointNoMass:
        'The body mass of joint {{name}} is unknown (no shapes, or not loaded yet), so 1 g is used. Enter a mass in the mass card.',
      worldJointMassPending:
        'The body of joint {{name}} still has {{count}} mesh(es) loading; their mass is left out.',
      worldJointNoMotor:
        'No motor is chosen for the motor drive of joint {{name}}, so it is not driven.',
      worldJointMotorMissing:
        'A drive motor of joint {{name}} is not in this robot (deleted, on another robot, or a duplicate name), so that motor is not used.',
      worldJointMotorOnWheel:
        'Motor {{motor}} drives a wheel, so it does not also drive joint {{name}}.',
      worldJointMotorShared:
        'Motor {{motor}} already drives an earlier joint, so joint {{name}} does not use it.',
      worldJointMotorsDiffer:
        'The motors driving joint {{name}} have different types or gear ratios; the first motor’s values are used.',
      worldJointServoMissing:
        'The servo of joint {{name}} is not in this robot (deleted, a different kind, or on another robot), so the joint is not driven.',
      worldJointServoShared:
        'Servo {{servo}} already drives an earlier joint or shares its name with another device, so joint {{name}} is not driven. A servo drives only one joint (model a two-finger claw as one joint).',
      worldJointRatioRange:
        'The drive ratio of joint {{name}} from its gear ratio and spool diameter is outside the simulator range, so the joint is not driven.',
      worldJointServoOnSlide:
        'A position servo drives only revolute joints. Drive prismatic joint {{name}} with a CR servo and a spool.',
      worldJointStageInvalid:
        'Stage {{stage}} of slide {{name}} is not a prismatic joint (drive: stage) directly under the stage below it, so stages from there on are not linked.',
      worldJointStageOrphan:
        'Joint {{name}} is a stage but no slide drive includes it, so it is not driven.',
      worldLimitSwitchJointMissing:
        'The joint of limit switch {{name}} is not in this robot, so the switch is never pressed.',
      worldLimitSwitchNoLimit:
        'Joint {{joint}} of limit switch {{name}} has no limits, so the switch is never pressed.',
      worldLimitSwitchDuplicate:
        'The device name of limit switch {{name}} is shared with another device, so the switch is never pressed.',
      worldLimitSwitchTooMany:
        'Joint {{joint}} has more limit switches than the simulator limit ({{max}}), so {{name}} is never pressed.',
      worldSensorOnJoint:
        '{{name}} is on joint {{joint}}, but the simulator computes it as attached to the robot body (in the edit pose).',
      worldSensorNoHousing:
        'Sensor {{name}} has no shape or is still loading, so it is measured from the pivot instead of the housing front.',
      worldSensorOnRobot:
        'Sensor {{name}} is attached to the robot or a CAD root, so it is measured from the pivot. Attach it to the sensor part.',
      worldSensorFarHousing:
        'The housing front of sensor {{name}} is {{distance}} from the pivot. Check that it is not attached to a group larger than the sensor.',
      worldSensorBelowFloor:
        'The front of sensor {{name}} is below the floor, so it may not see the floor.',
      worldSensorSelfHit:
        '{{part}} on this robot blocks the beam of sensor {{name}}. The simulator does not see its own robot, so the values differ from the real robot.',
      worldDuplicateSensor:
        'Sensor device name {{name}} is empty or used by another device, so the simulator does not use that sensor.',
      worldTooManyDistanceSensors:
        'There are more distance sensors than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldTooManyColorSensors:
        'There are more color sensors than the simulator limit ({{max}}); only the first {{max}} are used.',
      worldWheelOnJoint:
        'Wheel {{name}} is on joint {{joint}}, but the simulator computes it as attached to the robot body (in the edit pose).',
      worldGenerationStale:
        'Device names may differ from the generated configuration, so the wheels and joints may not move.',
      worldInvalid: 'Could not build the simulator world, so the robot will not move ({{detail}}).',
      generationBlocked:
        'The last save did not generate code because of {{count}} hardware error(s). Running with the previous hardware class and configuration left in TeamCode.',
      generationFailed:
        'The last save could not write the generated code ({{detail}}). The hardware class and configuration in TeamCode may differ from the scene.',
      configNotGenerated:
        '{{file}} was edited by the team or made by hand, so SandBot did not overwrite it. Running with the configuration in that file.',
      configMissing:
        'The robot configuration {{file}} is not in TeamCode, so the run uses an empty hardwareMap. Saving the project generates it.',
      // Reading the registrar (@OpModeRegistrar) OpMode list
      registeredFailed: 'Could not read the registrar OpMode list: {{reason}} ({{detail}})',
      registeredCompileFailed:
        'The registrar (@OpModeRegistrar) files did not compile, so the registrar OpModes could not be read ({{count}} errors). Double-click a diagnostic to open its line.',
      // A Scene view Dashboard overlay image (drawImage '/images/…') could not be read (once per image per run). It is
      // read again when the user comes back to the SandBot window or INITs again.
      dashImageMissing:
        'The Dashboard image TeamCode/src/main/assets/{{path}} does not exist, so it is not drawn. Add the file and come back to the SandBot window, or INIT again, to read it again.',
      dashImageNotAllowed:
        'The Dashboard image TeamCode/src/main/assets/{{path}} is not read because it is not a regular file or points outside assets ({{detail}}).',
      dashImageTooLarge:
        'The Dashboard image TeamCode/src/main/assets/{{path}} is over the size limit ({{max}} MB), so it is not drawn ({{detail}}).',
      dashImageFailed:
        'Could not read the Dashboard image TeamCode/src/main/assets/{{path}}, so it is not drawn ({{detail}}). Fix it and come back to the SandBot window, or INIT again, to read it again.',
      // Simulator notices (simNotice, SimNoticeCode)
      sim: {
        sharedEncoderMode:
          'The motor {{device}} runs in an encoder mode (RUN_USING_ENCODER or RUN_TO_POSITION). A dead wheel shares its port, so on the real robot it is controlled by the pod encoder, but the simulator assumes the motor shaft encoder.',
        worldError:
          'The simulator failed while computing and keeps sending the previous sensor values ({{detail}}).',
        tipping:
          'The robot centre of mass went outside what the wheels can support (a real robot may tilt or tip over). The simulator only computes on the floor plane, so the robot does not tip.',
        wheelLift:
          'One or more wheels stayed off the floor with no load for more than 0.1 s. Those wheels spin freely meanwhile.',
        dashCamera:
          'The FTC Dashboard camera stream (startCameraStream) is not simulated. The call does nothing.',
        dashImage: 'FTC Dashboard sendImage is not shown. The call does nothing.',
        // file: absolute path in the simulated storage (userData/sim-files/<project>/FIRST, the robot's /sdcard/FIRST)
        rrTuningSaved: 'Saved the Road Runner tuning result: {{file}}'
      },
      // Library dependency report (INIT, src/main/libraries)
      library: {
        summary:
          '{{count}} libraries in the team Gradle files: {{used}} used · {{provided}} provided · {{unsupported}} not loaded · {{failed}} not downloaded',
        summaryPlatform:
          '{{count}} libraries in the team Gradle files: {{used}} used · {{provided}} provided · {{unsupported}} not loaded · {{failed}} not downloaded · compiled against Android API {{api}}',
        platformGuessed:
          'compileSdk was not found in the Gradle files, so the code is compiled against the highest installed Android platform (API {{api}}). Results may differ from Android Studio.',
        firstUse:
          '{{coordinate}}: the repository publishes no checksums, so the hash of the first download was recorded. If the content changes later, it will not be used.',
        firstUseUnrecorded:
          '{{coordinate}}: the repository publishes no checksums, and the hash of the first download could not be saved (first-use.json in the library cache is not writable). It is used this time, but a changed file is not caught yet. The next INIT checks it again and saves the hash.',
        // FTC Dashboard (status replaced): compiled against the team's real jar, run on SandBot's implementation
        replaced:
          '{{coordinate}}: FTC Dashboard compiles against the real jar of this version and runs on the SandBot implementation (no port or web server). Packets appear in Telemetry and the Scene view, @Config values in the Config tab; camera streams and images are not shown.',
        // The Sloth build of FTC Dashboard (com.acmerobotics.slothboard)
        slothboard:
          '{{coordinate}}: the Sloth build of FTC Dashboard is not supported, so it is not loaded. Use the original FTC Dashboard (com.acmerobotics.dashboard:dashboard).',
        links:
          '{{library}}: {{count}} link problem(s) (missing classes or members, SDK features not supported yet). Reaching that code causes a runtime error.',
        none: '{{coordinate}}',
        pedroTuning:
          '{{coordinate}}: Pedro AutoTune (tuning) uses a web server and its own threads, so it only runs on the robot. SandBot does not load it (tuning code does not compile).',
        pedro2:
          '{{coordinate}}: Pedro Pathing 2.x is not supported. Move to 3.x or newer (com.pedropathing:revhub).',
        panels: '{{coordinate}}: Panels (com.bylazar) is not supported, so it is not loaded.',
        dairy:
          '{{coordinate}}: Sloth and Sinister (dev.frozenmilk) are Android app hooks and hot reload, which SandBot cannot use, so they are not loaded.',
        ftcLibVision: '{{coordinate}}: FTCLib vision uses native OpenCV, so it is not loaded.',
        notSupported:
          '{{coordinate}}: not a library SandBot supports (Road Runner 1.0, Pedro Pathing 3.x, FTCLib core, FTC Dashboard) or one of their dependencies, so it is not loaded.',
        dynamicVersion:
          '{{coordinate}}: the version is not fixed (+, latest, a range or SNAPSHOT), so it is not loaded. Use an exact version so every run is the same.',
        localModule: '{{coordinate}}: SandBot does not read local module or file dependencies.',
        repositoryNotAllowed:
          '{{coordinate}}: the Gradle files do not declare the repository this library comes from, and SandBot does not allow the other declared repositories.',
        notFound: '{{coordinate}}: not found in the repository or the Gradle cache.',
        offline:
          '{{coordinate}}: the network could not be reached and it is not cached. Connect to the internet and INIT again (after one Android Studio build it is read from the Gradle cache).',
        rateLimited:
          '{{coordinate}}: the repository refused the request (HTTP 429). INIT again in a moment.',
        checksumMismatch:
          '{{coordinate}}: the downloaded file does not match its checksum or recorded hash, so it is not used.',
        tooLarge: '{{coordinate}}: the file is over the size limit, so it was not downloaded.',
        badArchive:
          '{{coordinate}}: the jar or AAR cannot be read or contains native code (jni), so it is not used.',
        protectedPackage:
          '{{coordinate}}: it contains classes in JDK or FTC SDK packages, so it is not used.',
        badMetadata: '{{coordinate}}: the POM or Gradle module metadata cannot be read.',
        cancelled: '{{coordinate}}: the download was cancelled.'
      }
    },
    // Details of a dependency report entry
    library: {
      detail: 'Detail',
      requestedBy: 'Requested by',
      requested: 'Requested versions',
      source: 'Source',
      integrity: 'Integrity',
      sources: {
        gradleCache: 'Android Studio Gradle cache',
        libraryCache: 'SandBot library cache',
        download: 'downloaded from the repository'
      },
      integrities: {
        checksum: 'matches the repository checksum',
        pinned: 'matches the hash SandBot knows',
        firstUse: 'hash of the first download recorded (no checksums in the repository)',
        gradleCache: 'matches the Gradle cache SHA-1',
        firstUseUnrecorded:
          'hash of the first download not saved (no checksums in the repository; saved at the next INIT)'
      },
      linkKind: {
        missingClass: 'missing class',
        missingMember: 'missing member',
        unsupported: 'not supported yet'
      },
      hintNotLoaded:
        'This package belongs to {{coordinate}}, declared in the team Gradle files, but SandBot did not load it. {{reason}}',
      hintDependencyNotLoaded:
        'This package belongs to {{coordinate}}, a dependency of {{requestedBy}} declared in the team Gradle files, but SandBot did not load it. {{reason}}',
      hintUndeclared:
        'The library of package {{packageName}} is not declared in the team Gradle files (TeamCode/build.gradle and so on). It does not compile in Android Studio either.',
      hintMaybeUndeclared:
        'The library of package {{packageName}} was not found in the team Gradle declarations SandBot read. It may be in Gradle content SandBot could not read or in a library it did not load (see the Gradle and library lines in the Console).'
    },
    // What could not be resolved while reading the team Gradle files (GradleDiagnosticCode)
    gradle: {
      unresolvedValue:
        'the value cannot be resolved to a literal, so this declaration was not read',
      unsupportedSyntax: 'syntax SandBot cannot read, skipped',
      remoteScript: 'remote scripts (apply from: https://…) are not read',
      outsideProject: 'files outside the project are not read',
      missingFile: 'the apply from file does not exist',
      tooLarge: 'the file is too large, so it was not read',
      tooDeep: 'nesting or apply from is too deep, or the file is too complex, so reading stopped',
      tooMany:
        'a count limit was exceeded, so what is over the limit (or the whole declaration whose list is over it) was not read',
      tooMuchWork:
        'reading the Gradle files takes too much work, so reading stopped here; what was read before is used',
      localDependency:
        'SandBot does not use local module or file dependencies (project(), files(), fileTree)',
      versionCatalogEntry: 'not found in gradle/libs.versions.toml'
    }
  },
  // Telemetry tab (like the Driver Station screen)
  telemetry: {
    noRun: 'Run an OpMode to see telemetry like on the Driver Station.',
    empty: 'No telemetry received yet (it appears when telemetry.update() sends).',
    log: 'Telemetry log',
    sentAt: 'Virtual time sent',
    // FTC Dashboard telemetry (sendTelemetryPacket; last value per key, like the Dashboard Telemetry panel)
    dashboard: 'FTC Dashboard',
    dashboardHint:
      'Packets sent to FTC Dashboard (TelemetryPacket.put and addLine). The last value of each key is shown, and clearTelemetry clears it. The field drawing (fieldOverlay) is drawn on the Scene view floor.',
    dashboardEmpty: 'The packets received so far have no values.',
    dashboardLog: 'Dashboard log'
  },
  // Config tab (@Config and addConfigVariable variables, like the FTC Dashboard Configuration panel)
  config: {
    noRun:
      'Run an OpMode to see the FTC Dashboard @Config values here and edit them while it runs (like the Dashboard Configuration panel).',
    empty:
      'This run has no Dashboard configuration variables (no @Config classes or addConfigVariable).',
    waiting:
      'Waiting for the Dashboard configuration variables (none arrive if the OpMode does not use FTC Dashboard).',
    tree: 'Dashboard configuration variables',
    revertHint:
      'Values changed during a run revert on STOP (the next run uses the file values). To keep one, press [Apply to file] and then save (Ctrl+S).',
    readOnlyHint:
      'Values can be edited only during INIT and while running. The last values stay until the next INIT.',
    hardware: 'Hardware (withHardwareRoot)',
    expand: 'Expand',
    collapse: 'Collapse',
    changed: 'Some values differ from the start of this run.',
    startValue: '(start {{value}})',
    startValueHint: 'The value when this run started.',
    sentHint: 'Sent. It is applied at the next tick boundary (when the run continues, if paused).',
    invalidHint: 'This value does not fit the type, so it is not sent.',
    tooLongHint: 'Longer than {{max}} characters, so it is not sent.',
    apply: 'Apply to file',
    applyHint:
      'Move this value to the {{field}} tunable value in {{file}} as an unsaved change. Saving (Ctrl+S) writes it to the Java file. You can undo it.',
    applied: 'Applied (unsaved)',
    // Why [Apply to file] is unavailable (play/dashConfigModel.ts ApplyBlock)
    applyBlocked: {
      noSource:
        'This variable is not read from a field (addConfigVariable, an array element and so on), so it cannot be applied to a file.',
      notTeamCode:
        'This value belongs to a class outside the TeamCode Java files, so it cannot be applied to a file.',
      loading: 'Reading {{file}}.',
      missing:
        '{{file}} was not found in TeamCode, so the value cannot be applied (it may be a library class).',
      readFailed: 'Could not read {{file}}, so the value cannot be applied.',
      file: '{{file}} cannot be edited (read-only, another encoding, a generated file, \\u escapes and so on), so the value cannot be applied.',
      noField:
        'The {{field}} tunable value was not found in {{file}} (a field of a superclass in another file, a removed field and so on).',
      typeChanged:
        'The type of {{field}} in the file differs from the code that ran, so the value cannot be applied.',
      value:
        'This value cannot be written as a Java literal of that type (NaN, infinity and so on).',
      inFile: 'The file already has this value.',
      applied: 'Already applied. Saving (Ctrl+S) writes it to the file.',
      readOnly: '{{field}} in the file: {{reason}}'
    }
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
    selectHint: 'Click to select {{name}}.',
    joints: 'Joints',
    jointName: 'Joint',
    jointType: 'Type',
    jointValue: 'Value',
    jointsHint:
      'Joint positions sent by the simulator (the edit pose is 0). Click to select the object.'
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
    objectMissing: '(object not found)',
    // Simulator-only properties (not in the generated code)
    simulationOnly:
      'Simulator-only setting (not written to the generated code or configuration XML).',
    gearboxModelDefault: 'Model default',
    gearboxReset: 'Model default',
    gearboxResetHint: 'Go back to the SDK gear ratio of the motor type.',
    gearboxResetHintJoint:
      'Go back to the datasheet gear ratio of the motor type (the actual value the joint simulation uses).',
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
      friction: 'Friction',
      frictionDefault: 'Kind default ({{value}})',
      frictionHint:
        'Friction coefficient of the locked wheel dragged on the field tiles (the CoF manufacturers publish). While the wheels slip, the robot accelerates at about μ·g. For mecanum wheels the simulator converts it to a roller-axis coefficient (√2·μ minus the roller resistance share), so that a locked wheel still drags with this coefficient. Leave it empty to use the kind default (an assumption, not measured).',
      wheelMass: 'Wheel mass {{mass}} · spin inertia {{inertia}} kg·m²',
      wheelMassDefault:
        'Wheel mass {{mass}} (kind default, mass unknown) · spin inertia {{inertia}} kg·m²',
      wheelMassDefaultHint:
        "The mass model does not know this wheel's mass (shapes loading or not loaded, surface meshes, a group without shapes, or nothing left after subtracting its hardware), so the spin inertia uses the kind's default mass. You can enter a mass in the mass card.",
      wheelMassClipped:
        'Wheel mass {{mass}} (clipped from the mass model value {{model}}) · spin inertia {{inertia}} kg·m²',
      wheelMassClippedHint:
        'The mass under this wheel is too large or too small for a single wheel, so the spin inertia uses it clipped to {{min}}–{{max}}. Put the wheel component on the wheel part (or a group holding only the wheel).',
      staticLoad: 'Load at rest ≈ {{load}} N · traction limit ≈ {{limit}} N',
      staticLoadUnknown: 'The load at rest appears once the robot mass is computed.',
      frictionRejected:
        'Enter a friction coefficient from {{min}} to {{max}}. Leave it empty to use the kind default.',
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
      traction: 'Forward traction-limited acceleration ≈ {{accel}} {{unit}}/s² ({{g}} g)',
      tractionHint:
        'The force the floor can give toward the robot front (+X) while all wheels slip, divided by the robot mass. Each driven wheel counts with its load at rest, friction coefficient and rolling direction and rollers (mecanum, omni). Wheels rolling at an angle, as in an X-drive, push forward less (on omni wheels the roller resistance opposes the motion and lowers it further), and a wheel rolling sideways (H-drive) does not push forward.',
      topSpeed: 'Top speed ≈ {{speed}} {{unit}}/s (free, {{volts}} V)',
      topSpeedRange:
        'Top speed ≈ {{min}}–{{max}} {{unit}}/s (differs per wheel, free, {{volts}} V)',
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
      podCpr: 'Encoder CPR',
      stallTorque: 'Stall torque (N·m, 0 = datasheet)',
      freeSpeed: 'Free speed (rpm, 0 = datasheet)',
      servoModel: 'Servo model',
      limitJoint: 'Limit switch joint',
      limitAt: 'Pressed at',
      limitDistance: 'Press distance',
      limitAngle: 'Press angle',
      aimYaw: 'Aim yaw',
      aimPitch: 'Aim elevation (up +)'
    },
    propHints: {
      stallTorque:
        'The torque the simulator uses for this motor (wheel, joint, intake and so on). 0 uses the datasheet value for the model and ratio; enter a measured value to override it. The generated code does not use it.',
      freeSpeed:
        'The speed the simulator uses for this motor (wheel, joint, intake and so on). 0 uses the datasheet value for the model and ratio; enter a measured value to override it. The generated code does not use it.',
      limitDistance:
        'The switch is pressed while the linked prismatic joint is within this distance of the chosen end. 0 means the default, 2 mm.',
      limitAngle:
        'The switch is pressed while the linked revolute joint is within this angle of the chosen end. 0 means the default, 1°.',
      aimYaw:
        'Counterclockwise + from the robot front (+X). In robot coordinates, independent of the CAD part rotation. When looking up or down, yaw barely changes the reading.',
      aimPitch:
        'Up from horizontal is +; looking down is −90° (the opposite sign of Transform rotation Y). In robot coordinates.'
    },
    aimRunningHint: 'Applies from the next INIT.',
    sensorReading: {
      distance: 'Edit pose value: {{value}} ({{surface}})',
      distanceOut: 'Edit pose value: out of range (getDistance returns {{max}})',
      distanceWeak: 'Edit pose value: weak signal (reflectance {{reflectance}}, max {{maxRange}})',
      color:
        'red {{r}} · green {{g}} · blue {{b}} · normalized (gain {{gain}}) {{nr}}·{{ng}}·{{nb}} · alpha {{alpha}}',
      colorDistance: 'getDistance {{distance}} (actual {{actual}}, {{surface}})',
      colorNothing:
        'Nothing in view: the axis hits no surface, so these are background values and getDistance is at its maximum.',
      hint: "Computed in the edit pose (joints at 0) on the chosen season field with the same calculation as the simulator. Noise and the chip measurement period are not included. Values while running are in the Devices tab (raw chip values). Other robots and game elements are not seen. Sensors still see structures when field elements are hidden. In the 'none' season the walls are computed as rails and clear panels. getDistance differs from the actual distance depending on the surface reflectance (the REV fit is for white card).",
      surfaces: {
        floor: 'Floor tile',
        tape: '{{alliance}} {{name}}',
        rail: '{{wall}} rail',
        panel: '{{wall}} clear panel',
        alliances: {
          red: 'Red',
          blue: 'Blue'
        }
      },
      tails: {
        onRobot:
          'Attached to the robot or a CAD root, so measured from the pivot. Attach it to the sensor part.',
        pivotLoading: 'The shape is still loading, so measured from the pivot.',
        pivot: 'No shape, so measured from the pivot instead of the housing front.',
        farHousing:
          'The housing front is {{distance}} from the pivot. Check that it is not attached to a group larger than the sensor.',
        belowFloor: 'The sensor front is below the floor.',
        outsideField: 'The sensor front is outside the field walls.',
        selfHit:
          '{{part}} on this robot blocks the beam {{distance}} ahead (the simulator does not see its own robot).',
        selfHitPartial:
          'The edge of the cone hits this robot (the simulator does not see its own robot).'
      },
      excluded: {
        emptyName: 'Left out of the simulator: the device name is empty.',
        duplicateName: 'Left out of the simulator: the device name is used by another device.',
        tooMany:
          'Left out of the simulator: there are more sensors of this kind than the simulator limit.',
        outsideRobot: 'Left out of the simulator: it is not on a robot.'
      }
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
      },
      servoModel: {
        gobildaTorque: 'goBILDA 2000 Torque (25-2)',
        gobildaSpeed: 'goBILDA 2000 Speed (25-3)',
        gobildaSuperSpeed: 'goBILDA 2000 Super Speed (25-4)',
        axonMax: 'Axon MAX',
        axonMini: 'Axon MINI',
        axonMicro: 'Axon MICRO',
        revSmartServo: 'REV Smart Robot Servo'
      },
      limitAt: {
        lower: 'Lower limit',
        upper: 'Upper limit'
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
      motorOutputRatio:
        'Output shaft {{rpm}} RPM (free, 12 V) · {{ticks}} ticks/rev · torque and speed use the actual ratio {{ratio}}:1',
      jointMotorOutput:
        'Joint: output shaft {{rpm}} RPM (free, 12 V) · {{ticks}} ticks/rev · actual ratio {{ratio}}:1',
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
  },
  mass: {
    addOption: 'Mass',
    title: 'Mass',
    orphan: 'This object is not part of a robot, so it does not count toward a robot mass.',
    material: 'Material',
    materialHint:
      'Material of this object and the parts under it. A child that sets its own material uses that. When empty, the material comes from the object above, then name rules (screws, bearings, …), then the robot default material.',
    materialGroups: {
      stock: 'Stock',
      printed: '3D printed'
    },
    materials: {
      aluminum6061: 'Aluminum 6061',
      aluminum7075: 'Aluminum 7075',
      steel: 'Steel',
      stainless: 'Stainless steel',
      brass: 'Brass',
      polycarbonate: 'Polycarbonate',
      acetal: 'Acetal (POM)',
      hdpe: 'HDPE',
      nylon: 'Nylon',
      carbonFiber: 'Carbon fiber',
      plywood: 'Plywood',
      rubber: 'Rubber',
      foam: 'Foam',
      pla: 'PLA',
      petg: 'PETG',
      abs: 'ABS',
      tpu: 'TPU'
    },
    inheritObject: 'Inherited: {{material}} ({{owner}})',
    inheritRobot: 'Inherited: {{material}} (robot default)',
    inheritBuiltIn: 'Inherited: {{material}} (default)',
    inheritNameRule: 'Inherited: name rule ‘{{rule}}’',
    infill: 'Infill (%)',
    infillHint:
      'The slicer infill. Walls and top/bottom layers (about 1.1 mm) count as solid; the infill applies inside them. Children inherit it.',
    infillInherited: 'Inherited {{percent}}',
    infillDefault: 'Default {{percent}}',
    override: 'Mass override',
    overrideHint:
      'Mass of everything under this object (a weighed subassembly, a datasheet value). It is spread over the shapes under it by volume. Leave empty to estimate.',
    overridePlaceholder: 'Estimated {{mass}}',
    massInputHint:
      'You can type a unit (e.g. 437g, 1.2kg, 3lb, 8oz). Without a unit it is {{unit}}.',
    massInputRejected:
      'Not accepted, so nothing changed. Enter a mass above 0 and at most {{max}} ({{unit}} without a unit). Press Esc to revert.',
    infillRejected:
      'Not accepted, so nothing changed. Enter an infill between 0 and 100 (%). Press Esc to revert.',
    centerOfMass: 'Center of mass',
    centerOfMassAuto: 'Automatic',
    centerOfMassUnused:
      'This center of mass is not used now. It only applies when the mass is entered directly or this object has a datasheet mass.',
    centerOfMassHint:
      'Center of mass of the overridden (or datasheet) mass, in this object’s local frame. Automatic uses the center of the shapes under it.',
    result: 'Result: {{mass}} · {{source}}',
    resultNone: 'No mass computed yet.',
    scaledTag: '(scaled to the weighed mass)',
    loadingTag: '(shapes loading, partly counted)',
    massLoading: '—',
    resultCenterRobot: 'Center of mass (robot)',
    resultCenterField: 'Center of mass (field)',
    resultCenterHint: 'Center of mass of everything under this object. Computed; read-only.',
    hint: 'Mass is a simulator setting. It does not affect generated code or the configuration XML. The scene view shows this object’s center of mass (small white dot) and the robot’s (teal cross).',
    estimateLine: 'Mass (estimated) {{mass}} · {{source}}',
    estimateHint: 'Click to add a Mass card and set the material or mass.',
    source: {
      from: '{{text}} ({{owner}})',
      override: 'Override',
      cots: 'Datasheet: {{product}}',
      ratio: '{{product}} {{ratio}}:1',
      cartridges: '{{product}} ({{count}} cartridge(s))',
      material: 'Material: {{material}}',
      nameRule: 'Name rule: ‘{{rule}}’',
      nameRuleMaterial: 'Name rule: ‘{{rule}}’ → {{material}}',
      nameRuleZero: 'Name rule: ‘{{rule}}’ (no mass)',
      robotDefault: 'Robot default material: {{material}}',
      defaultMass: 'Default (no mass information)',
      none: 'No mass (no shape or a surface mesh)',
      loading: 'Shapes loading'
    },
    warnings: {
      scaleUnusual:
        'Matching the weighed mass needs the estimated mass × {{scale}}. That is more than the wires, screws and hubs missing from CAD (usually 5–15% of the total); check materials, infill and missing parts.',
      scaleImpossible:
        'Not scaled to the weighed mass: the override and datasheet mass ({{fixed}}) is at least the weighed mass ({{weighed}}), or there is no shape to estimate.',
      defaultMass:
        'No shape can be weighed, so the default {{mass}} (typical of FTC competition robots) is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). Enter the weighed mass or import a solid CAD.',
      defaultMassFixed:
        'No shape can be weighed, so of the default {{mass}} (typical of FTC competition robots) the override and datasheet mass {{fixed}} stays in place and the remaining {{rest}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). Enter the weighed mass or import a solid CAD.',
      defaultMassCovered:
        'No shape can be weighed, but the override and datasheet mass {{fixed}} is at least the default {{mass}}, so only that mass is used and no bounding box mass is added. Enter the weighed mass or import a solid CAD.',
      defaultMassLoadingDefault:
        'While the shapes load, the default {{mass}} (typical of FTC competition robots) is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). It is computed from the shapes once they have loaded.',
      defaultMassLoadingDefaultFixed:
        'While the shapes load, of the default {{mass}} (typical of FTC competition robots) the override and datasheet mass {{fixed}} stays in place and the remaining {{rest}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). It is computed from the shapes once they have loaded.',
      defaultMassLoadingCovered:
        'While the shapes load, only the override and datasheet mass {{fixed}} is used (it is at least the default {{mass}}, so no bounding box mass is added). It is computed from the shapes once they have loaded.',
      defaultMassWeighed:
        'No shape can be weighed, so the weighed mass {{mass}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). Import a solid CAD to distribute it by shape.',
      defaultMassLoading:
        'While the shapes load, the weighed mass {{mass}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). It is distributed by shape once they have loaded.',
      defaultMassLoadingFixed:
        'While the shapes load, the override and datasheet mass {{fixed}} of the weighed mass {{mass}} stays in place and the remaining {{rest}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). It is distributed by shape once they have loaded.',
      defaultMassWeighedFixed:
        'No shape can be weighed, so the override and datasheet mass {{fixed}} of the weighed mass {{mass}} stays in place and the remaining {{rest}} is spread evenly over the robot bounding box (center of mass and inertia approximated by the box). Import a solid CAD to distribute it by shape.',
      pending: '{{count}} mesh(es) still loading are not counted yet.',
      missing:
        '{{count}} mesh(es) without shape information are not counted. If the CAD failed to load or was cancelled, reload it or locate the file again from its CAD root.',
      pendingCovered:
        '{{count}} mesh(es) inside objects with an override or datasheet mass are still loading, so that mass is placed on the loaded shapes (or at the object origin if none).',
      missingCovered:
        '{{count}} mesh(es) inside objects with an override or datasheet mass have no shape information, so that mass is placed on the remaining shapes (or at the object origin if none).'
    },
    notices: {
      innerMassExceeds:
        'The mass overrides inside {{object}} add up to {{inner}}, more than its own mass ({{mass}}), so the inner values are used as they are.',
      centerOfMassIgnored:
        'The center of mass override on {{object}} is not used. It applies only to an object with a mass override or a datasheet mass, and only when inner overrides leave some of that mass to move.',
      podIgnored:
        '{{object}} cannot be the Pinpoint pod of {{pinpoint}}, so it is estimated without the pod mass ({{reason}}).',
      cotsIgnored:
        'What is under {{object}} cannot be a single {{product}}, so its datasheet mass is not used and the shapes are estimated instead ({{reason}}). Attach it to an object that holds only that part.',
      cotsReasons: {
        otherRobot: 'it is in a different robot from the Pinpoint',
        containsPinpoint: 'it is the Pinpoint itself or contains it',
        containsCots:
          'it contains other off-the-shelf parts (motors, servos, wheels, pods, SKU names)',
        containsCad: 'it contains a CAD root',
        tooLarge: 'its shape is too large for that one part'
      }
    },
    rigidbody: {
      title: 'Rigidbody',
      simulationOnly: 'Simulator',
      mass: 'Mass',
      massNone: '—',
      breakdown: 'Override/datasheet {{fixed}} + estimated {{estimated}}',
      breakdownDefault: 'Default (no shape can be weighed, approximated by the bounding box)',
      breakdownDefaultLoading: 'Default (shapes loading, approximated by the bounding box)',
      breakdownDefaultFixed:
        'Default: override and datasheet {{fixed}} + remaining {{rest}} (no shape can be weighed, approximated by the bounding box)',
      breakdownDefaultLoadingFixed:
        'Default: override and datasheet {{fixed}} + remaining {{rest}} while shapes load (approximated by the bounding box)',
      breakdownWeighedBox:
        'Weighed mass (no shape can be weighed, approximated by the bounding box)',
      breakdownWeighedFixed:
        'Weighed mass: override and datasheet {{fixed}} + remaining {{rest}} while shapes load (approximated by the bounding box)',
      breakdownWeighedBoxFixed:
        'Weighed mass: override and datasheet {{fixed}} + remaining {{rest}} (no shape can be weighed, approximated by the bounding box)',
      breakdownWeighedLoading: 'Weighed mass (shapes loading, approximated by the bounding box)',
      scaled: '· estimate ×{{scale}} (scaled to the weighed mass)',
      weighed: 'Weighed mass',
      weighedHint:
        'The whole robot on a scale. When set, the estimated parts are scaled by one ratio so that they add up to the rest after the override and datasheet masses.',
      weighedPlaceholder: 'Empty: use the estimate',
      defaultMaterial: 'Default material',
      defaultMaterialHint:
        'Material of parts that set none and match no name rule. FTC robot structure is usually aluminum.',
      defaultMaterialBuiltIn: '{{material}} (default)',
      centerOfMass: 'Center of mass',
      centerOfMassHint:
        'Center of mass from the robot origin (center, floor). X forward · Y left · Z up. Computed; read-only.',
      principalMoments: 'Principal inertia',
      principal1: 'I₁',
      principal2: 'I₂',
      principal3: 'I₃',
      inertiaUnit: 'kg·m²',
      principalMomentsHint:
        'Principal values of the inertia tensor about the center of mass (kg·m²). Computed.',
      openMeshes: '{{count}} open mesh(es) ({{percent}}% of the volume, approximate)',
      surfaceMeshes: '{{count}} surface mesh(es) (no mass)',
      pendingMeshes: '{{count}} loading',
      cadSummary: '{{name}}: {{parts}}',
      notices: 'Mass settings not used',
      hint: 'For heavy parts missing from CAD (battery, hubs, …), create an empty group in that place (Create Empty) and enter its mass: it becomes a point mass there. Scaling to the weighed mass spreads over all shapes, so it does not move the center of mass toward them.'
    }
  },
  // 관절 카드(Unity ArticulationBody, editor/joint/). 시뮬레이터 설정이라 생성 코드와 관계없다.
  joint: {
    addOption: 'Joint',
    title: 'Articulation Body',
    orphan: 'This object is not part of a robot, so the simulator does not use it.',
    type: 'Joint Type',
    types: {
      revolute: 'Revolute',
      prismatic: 'Prismatic'
    },
    anchor: 'Anchor',
    anchorHint:
      "The joint origin, in this object's local coordinates (its own axes). A revolute joint turns about an axis through this point; a prismatic joint does not depend on it.",
    anchorReset: 'To pivot',
    anchorResetHint: "Puts the anchor at this object's pivot (origin).",
    axis: 'Axis',
    axisSign: 'Axis direction',
    axisHint:
      "One of this object's local axes. A revolute joint is + by the right-hand rule about it; a prismatic joint is + along it. A CAD part's axes are the CAD file's axes.",
    robotAxis: 'Robot axis: {{axis}}',
    fieldAxis: 'Field axis: {{axis}}',
    robotAxes: {
      '+x': '+X (forward)',
      '-x': '−X (back)',
      '+y': '+Y (left)',
      '-y': '−Y (right)',
      '+z': '+Z (up)',
      '-z': '−Z (down)'
    },
    robotAxisVector: '({{x}}, {{y}}, {{z}})',
    limits: 'Motion',
    limited: 'Limited',
    limitedHint:
      'Turn off for a joint that spins without end (Unity Motion: Free). Prismatic joints are always limited.',
    lower: 'Lower Limit',
    upper: 'Upper Limit',
    limitsHint:
      'The edit pose (the pose in the scene now) is 0 and the limits must include it, so the lower limit is kept at 0 or below and the upper limit at 0 or above. The joint stops at a limit without bouncing.',
    friction: 'Joint Friction',
    frictionHint:
      'Constant (Coulomb) friction against motion, N·m for revolute and N for prismatic joints. Motor and servo gear friction is computed separately, so enter only the bearing or slide share.',
    damping: 'Damping',
    dampingHint: 'Friction proportional to speed (viscous).',
    units: {
      torque: 'N·m',
      force: 'N',
      rotaryDamping: 'N·m·s/rad',
      linearDamping: 'N·s/m',
      rotaryStiffness: 'N·m/rad',
      linearStiffness: 'N/m'
    },
    spring: 'Spring',
    springHint:
      'A spring on the joint (surgical tubing helping an arm, a constant-force spring on a lift and so on).',
    springKinds: {
      none: 'None',
      constantForce: 'Constant Force',
      linear: 'Linear'
    },
    springForce: 'Force',
    springForceHint:
      'A force (prismatic, N) or torque (revolute, N·m), 0 or more, pushing in the + direction at every position. To push in the − direction, flip the axis sign (the limits then follow that direction too).',
    springStiffness: 'Stiffness',
    springStiffnessHint: 'How strongly the spring pulls back per unit away from the rest position.',
    springRest: 'Rest Position',
    springRestHint: 'The joint position where the spring force is 0 (the edit pose is 0).',
    drive: 'Drive',
    driveHint:
      'The hub device that moves the joint. Targets and gains come from team code and the hub firmware (instead of the target and stiffness of a Unity drive).',
    driveKinds: {
      none: 'None',
      motor: 'DC motor',
      servo: 'Servo',
      crServo: 'Continuous rotation servo',
      stage: 'Upper stage (multi-stage slide)'
    },
    motors: 'Motors',
    motorsHint:
      "Motors that drive this joint together (up to {{max}}, like a two-sided lift). The motor's direction in the inspector is the one where +power moves the joint in its + direction.",
    noMotorOptions: 'This robot has no DC motors.',
    motorMissing: '(motor not found)',
    device: 'Device',
    deviceNone: '(none)',
    deviceMissing: '(device not found)',
    gearRatio: 'External gear ratio',
    gearRatioHint: "Reduction from the device's output shaft to the joint (1 if direct).",
    servoEditPosition: 'Edit-pose position',
    servoEditPositionHint:
      "The servo.setPosition value your code gives when the joint is at the edit pose in the scene (joint value 0). Range 0–1, default 0.5. Match it to how the servo horn is mounted. Example: if the claw is modelled closed and your code closes it with setPosition(0.35), enter 0.35. As in the SDK, the pulse goes through this servo component's direction (REVERSE), scale range (scaleRange) and pulse range (standard 600–2400 µs, full 500–2500 µs). If your code sets a different direction or range at run time, the edit pose is off by that much.",
    servoDirection: '+pulse direction',
    servoDirectionHint:
      'The way the joint turns when the pulse gets longer (how the servo is mounted). setDirection(REVERSE) on the servo component or in your code changes how setPosition becomes a pulse, so it reverses the joint on top of this, as on the real robot.',
    crServoDirectionHint:
      'The way the joint turns when the pulse gets longer (positive power with direction FORWARD), which is how the servo is mounted. Power 0 (1500 µs) always stops. setDirection(REVERSE) on the servo component or in your code reverses it on top of this, as on the real robot.',
    servoDirections: {
      forward: 'Joint + direction',
      reverse: 'Joint − direction'
    },
    spoolDiameter: 'Spool diameter',
    spoolDiameterHint:
      'Diameter of the spool (pulley) that winds the string. One turn moves one circumference. The default is a pulley with a 112 mm circumference.',
    rigging: 'Rigging',
    riggingHint:
      'How a multi-stage slide is strung. Cascade extends all stages together (the top stage moves the number of stages times faster); continuous extends the stages one after another with one string.',
    riggingKinds: {
      direct: 'Single stage',
      cascade: 'Cascade',
      continuous: 'Continuous'
    },
    stages: 'Upper stages',
    stagesHint:
      'The stages above this joint, from bottom to top. Each must be a prismatic joint under the stage right below it, with the drive "Upper stage".',
    stageAdd: 'Add stage…',
    stageRemove: 'Remove stage',
    stageRemoveLabel: 'Remove {{name}}',
    stageMissing: '(joint not found)',
    stageNone:
      'There is no prismatic joint under this object. Add a prismatic joint (drive: Upper stage) to the upper stage object.',
    stageOf: 'Moves with the drive of the lower stage {{name}}.',
    maxSpeedMotor: 'Top speed ≈ {{speed}} {{unit}} (no load, {{volts}} V)',
    maxSpeedServo: 'Top speed ≈ {{speed}} {{unit}} (no load)',
    endSpeed: 'Top stage ≈ {{speed}} {{unit}}',
    load: 'Gravity load (edit pose) ≈ {{load}} {{unit}}',
    loadWithSpring: 'Gravity and spring load (edit pose) ≈ {{load}} {{unit}}',
    loadNone: 'There is no gravity load in the edit pose.',
    loadNoneWithSpring: 'Gravity and the spring cancel out in the edit pose, so there is no load.',
    loadHint:
      'The force this joint (with the upper stages of a multi-stage slide) must hold in the edit pose: gravity from the mass and center of mass of the mass model, plus the spring force if there is a spring.',
    capacity: 'Stall torque ≈ {{capacity}} {{unit}}',
    capacityMargin: 'Stall torque ≈ {{capacity}} {{unit}} · margin ×{{margin}}',
    capacityForce: 'Stall force ≈ {{capacity}} {{unit}}',
    capacityForceMargin: 'Stall force ≈ {{capacity}} {{unit}} · margin ×{{margin}}',
    capacityHint:
      "The device's datasheet stall torque in joint coordinates (for a prismatic joint, the force at the spool) and its ratio to the load. Motors linked together count as the first motor's value × the number of motors (as in the simulator). Below 1 the joint cannot hold still.",
    preview: 'Preview',
    previewHint:
      'Moves the joint in the scene view to try it. It changes only the view, not the scene, saving or undo. Selecting another object returns to the edit pose.',
    previewReset: 'To 0',
    hint: "A joint is a simulator setting. It does not affect generated code or the configuration XML. This object and its children move as one body; the children of an inner joint are that joint's body.",
    warnings: {
      noMotor: 'No drive motor is selected, so the joint is not driven when running.',
      motorMissing:
        'A drive motor was not found in this robot (deleted, or on another robot). That motor is not used when running.',
      motorOnWheel: 'Motor {{motor}} drives a wheel, so this joint does not use it.',
      motorShared: 'Joint {{joint}} already drives motor {{motor}}, so this joint does not use it.',
      motorsDiffer:
        'The linked motors differ in type, gearbox or overridden values, so the simulator computes every motor with the values of the first one.',
      servoMissing:
        'The drive device was not found in this robot, so the joint is not driven when running.',
      servoOnSlide:
        'A position servo drives only revolute joints. Drive a prismatic joint with a continuous rotation servo and a spool.',
      stageInvalid:
        'Upper stage {{stage}} is not a prismatic joint (drive: Upper stage) under the stage right below it, so stages from there on are not linked.',
      stageOrphan: 'This stage is not in any multi-stage slide drive, so it is not driven.',
      noMass:
        "The body's mass (this object and its children, without the children of inner joints) is unknown (no geometry or zero mass), so the simulator uses 1 g. Enter a mass in a Mass card.",
      massPending: 'The mass of {{count}} meshes of the body still loading is missing.',
      cannotHold:
        'The stall torque (force) is less than the load in the edit pose, so the joint cannot hold.'
    }
  },
  // Season field (spec-4ab). Season data keys are the keys (src/shared/sim/seasons/). The season name BIOBUZZ is not translated.
  field: {
    seasons: {
      biobuzz: 'BIOBUZZ (2026-27)',
      none: 'None (nominal 12 ft)'
    },
    unknownSeason: 'Unknown season ({{season}})',
    walls: {
      red: 'Red wall',
      blue: 'Blue wall',
      audience: 'Audience wall',
      scoring: 'Scoring-side wall'
    },
    wallGeneric: 'Field wall',
    structures: {
      footBar: 'Foot bar',
      leg: 'HIVE leg',
      topBar: 'Top bar',
      logoPlate: 'Logo plate',
      flower: 'FLOWER',
      hiveCell: 'HIVE CELL'
    },
    tape: {
      loadingZoneSide: 'LOADING ZONE side tape',
      loadingZoneFront: 'LOADING ZONE front tape',
      garden: 'GARDEN tape',
      allianceArea: 'ALLIANCE AREA tape'
    },
    zones: {
      loadingZone: 'LOADING ZONE',
      garden: 'GARDEN'
    },
    hives: {
      hiveRed: 'Red HIVE',
      hiveBlue: 'Blue HIVE'
    },
    startPresets: {
      redWallScoring: 'Red wall · scoring side',
      redWallCenter: 'Red wall · center',
      redWallAudience: 'Red wall · audience side',
      audienceWall: 'Audience wall (red)',
      scoringWallCorner: 'Scoring-side wall · corner (red)',
      scoringWallCenter: 'Scoring-side wall · center (red)',
      blueWallAudience: 'Blue wall · audience side',
      blueWallCenter: 'Blue wall · center',
      blueWallScoring: 'Blue wall · scoring side',
      scoringWall: 'Scoring-side wall (blue)',
      audienceWallCorner: 'Audience wall · corner (blue)',
      audienceWallCenter: 'Audience wall · center (blue)'
    },
    overlapItem: '{{name}} ({{targets}})',
    inspector: {
      title: 'Field',
      season: 'Season',
      locked: 'Running',
      afterRun: 'Returns to the {{season}} field when the run ends.',
      axesBiobuzz: '+X audience wall, +Y blue wall, origin on top of the center tiles',
      axesNone: 'Nominal 12 ft, walls symmetric about the origin',
      axesNoDiagram:
        'The FTC field coordinate definition applied to this season layout (ftc-docs has no diagram for this season yet).',
      innerHalf: 'Wall inner half-width',
      hiveState: 'HIVE state',
      hiveRed: 'Red HIVE',
      hiveBlue: 'Blue HIVE',
      hiveStart: 'Start',
      hiveTipped: 'Tipped',
      hiveHint:
        'A personal run setting. It is not saved in the project, and the simulator uses it from the next INIT.',
      showElements: 'Show field elements',
      noStartPresets: 'This season has no start position presets.'
    }
  }
}

export default en
