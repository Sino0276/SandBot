/* eslint-disable @typescript-eslint/explicit-function-return-type -- 연구용 측정 스크립트(제품 코드가 아님) */
// 사용: node dump.mjs <step 파일> <출력 json>
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
// 저장소 루트의 node_modules에서 occt-import-js를 찾는다(이 파일은 docs/research/6b/cad-scripts/에 있다)
const require = createRequire(new URL('../../../../package.json', import.meta.url))
const occtimportjs = require('occt-import-js')
const [stepPath, outPath] = process.argv.slice(2)
const occt = await occtimportjs()
const t0 = Date.now()
const res = occt.ReadStepFile(new Uint8Array(readFileSync(stepPath)), { linearUnit: 'inch' })
console.error('read', res.success, (Date.now() - t0) / 1000, 's meshes', res.meshes.length)
// 노드 경로
const pathOf = new Map()
/** @returns {void} */
const walk = (node, path) => {
  const p = [...path, node.name]
  for (const m of node.meshes) pathOf.set(m, p)
  for (const c of node.children) walk(c, p)
}
walk(res.root, [])
const out = []
const verts = {}
res.meshes.forEach((m, i) => {
  const a = m.attributes.position.array
  let mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity]
  const n = a.length / 3
  const pts = new Float64Array(a.length)
  for (let k = 0; k < n; k++) {
    // FTC (X, Y, Z) = (CAD z, x, y)
    const X = a[3 * k + 2],
      Y = a[3 * k],
      Z = a[3 * k + 1]
    pts[3 * k] = X
    pts[3 * k + 1] = Y
    pts[3 * k + 2] = Z
    const v = [X, Y, Z]
    for (let j = 0; j < 3; j++) {
      if (v[j] < mn[j]) mn[j] = v[j]
      if (v[j] > mx[j]) mx[j] = v[j]
    }
  }
  out.push({
    i,
    name: m.name,
    path: pathOf.get(i),
    nverts: n,
    ntri: m.index.array.length / 3,
    min: mn,
    max: mx,
    color: m.color
  })
  const key = [m.name, ...(pathOf.get(i) || [])].join('/')
  if (
    /Hive|Flower|Cell|Goal|Damper|Pivot|Axle|Basket|Churro|Rib|Frame|Pollen|Nectar|Skin|Tag/i.test(
      key
    )
  )
    verts[i] = { pos: Array.from(pts), idx: Array.from(m.index.array) }
})
writeFileSync(outPath, JSON.stringify(out))
writeFileSync(outPath.replace(/\.json$/, '-verts.json'), JSON.stringify(verts))
console.error('done', (Date.now() - t0) / 1000)
