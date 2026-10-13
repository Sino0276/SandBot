import type { Messages } from './ko'

const en: Messages = {
  common: {
    dismiss: 'Dismiss'
  },
  toolbar: {
    language: 'Language',
    noProject: 'Unsaved scene',
    open: 'Open',
    openShortcut: 'Open an FtcRobotController folder (Ctrl+O)',
    save: 'Save',
    saveShortcut: 'Save (Ctrl+S)'
  },
  project: {
    chooseFolderTitle: 'Choose the FtcRobotController folder',
    chooseStepTitle: 'Choose a STEP file'
  },
  dialog: {
    unsavedChanges: 'You have unsaved changes. Save them?',
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
      'The part count of {{fileName}} differs from when it was saved. The CAD may have changed, so some parts may not match.'
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
    transformMode: 'Tool',
    translate: 'Move',
    rotate: 'Rotate',
    frame: 'Reference frame',
    field: 'Field',
    robot: 'Robot'
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
    frameRobot: 'Robot frame',
    robotOrigin: 'This is the origin of the robot frame, so its values are always 0.',
    notInRobot: 'Not part of a robot, so values are shown in the field frame.',
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
  }
}

export default en
