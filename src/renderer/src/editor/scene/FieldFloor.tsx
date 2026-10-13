import { useMemo } from 'react'
import { FIELD_SIZE, TILE_SIZE } from '../../scene/coordinates'

const TILES_PER_SIDE = Math.round(FIELD_SIZE / TILE_SIZE)
const WALL_HEIGHT = 0.3
const WALL_THICKNESS = 0.025

// 공칭 12 ft 필드: 바닥, 2 ft 타일 경계선, 낮은 벽
function FieldFloor(): React.JSX.Element {
  const half = FIELD_SIZE / 2

  const tileLines = useMemo(() => {
    const points: number[] = []
    for (let i = 0; i <= TILES_PER_SIDE; i++) {
      const c = -half + i * TILE_SIZE
      points.push(c, -half, 0, c, half, 0, -half, c, 0, half, c, 0)
    }
    return new Float32Array(points)
  }, [half])

  const walls: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [half, 0, WALL_HEIGHT / 2], size: [WALL_THICKNESS, FIELD_SIZE, WALL_HEIGHT] },
    { position: [-half, 0, WALL_HEIGHT / 2], size: [WALL_THICKNESS, FIELD_SIZE, WALL_HEIGHT] },
    { position: [0, half, WALL_HEIGHT / 2], size: [FIELD_SIZE, WALL_THICKNESS, WALL_HEIGHT] },
    { position: [0, -half, WALL_HEIGHT / 2], size: [FIELD_SIZE, WALL_THICKNESS, WALL_HEIGHT] }
  ]

  return (
    <group>
      <mesh>
        <planeGeometry args={[FIELD_SIZE, FIELD_SIZE]} />
        <meshStandardMaterial color="#3b3e45" />
      </mesh>
      <lineSegments position={[0, 0, 0.001]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[tileLines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#5c6069" />
      </lineSegments>
      {walls.map((wall, index) => (
        <mesh key={index} position={wall.position}>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color="#555963" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

export default FieldFloor
