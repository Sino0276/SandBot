import type { Messages } from './ko'

const en: Messages = {
  toolbar: {
    language: 'Language'
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
    importing: 'Importing {{fileName}}…',
    dismiss: 'Dismiss',
    expand: 'Expand',
    collapse: 'Collapse'
  },
  importError: {
    readFailed: 'Could not read {{fileName}} as a STEP file.',
    empty: '{{fileName}} contains no geometry to import.',
    unknown: 'Something went wrong while importing {{fileName}}.'
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
      forwardAxis: 'Forward axis'
    }
  }
}

export default en
