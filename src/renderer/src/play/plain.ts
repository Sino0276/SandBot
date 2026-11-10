// −0을 0으로(세계 설명·기준 해시가 −0을 다른 글자로 쓰지 않게). 센서·웹캠 장착(play/worldSensors.ts)과 충돌 형상
// (play/worldColliders.ts)이 같이 쓴다.
export const plain = (value: number): number => value + 0
