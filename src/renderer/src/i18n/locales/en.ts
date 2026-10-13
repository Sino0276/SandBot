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
    empty: 'No objects in the scene'
  },
  inspector: {
    empty: 'No object selected',
    transform: 'Transform',
    position: 'Position',
    rotation: 'Rotation',
    frameField: 'Field frame',
    frameRobot: 'Robot frame',
    robotOrigin: 'This is the origin of the robot frame, so its values are always 0.',
    notInRobot: 'Not part of a robot, so values are shown in the field frame.'
  }
}

export default en
