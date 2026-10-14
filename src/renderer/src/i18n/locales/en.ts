import type { Messages } from './ko'

const en: Messages = {
  common: {
    dismiss: 'Dismiss'
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
    redoShortcut: 'Redo (Ctrl+Shift+Z or Ctrl+Y)'
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
    cancel: 'Cancel'
  },
  notice: {
    importing: 'Importing {{fileName}}…',
    importReadFailed: 'Could not read {{fileName}} as a STEP file.',
    importEmpty: '{{fileName}} contains no geometry to import.',
    importFailed: 'Something went wrong while importing {{fileName}}.',
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
    codegenFailed: 'Could not write the generated code to TeamCode ({{detail}}).'
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
    part: 'Part'
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
    collapse: 'Collapse'
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
      relink: 'Locate file'
    }
  },
  hardware: {
    badge: '⚙ {{count}}',
    severity: {
      error: 'Hardware error',
      warning: 'Hardware warning'
    },
    severityBelow: {
      error: 'Hardware error in a child object',
      warning: 'Hardware warning in a child object'
    },
    title: 'Hardware components',
    add: 'Add component…',
    remove: 'Remove',
    removeLabel: 'Remove {{name}}',
    empty: 'No components attached.',
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
        'Expansion Hub address {{address}} cannot be used (1–254, except 173).'
    }
  }
}

export default en
