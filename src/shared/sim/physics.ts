// 시뮬레이터의 물리 상수(SI 단위).

// 표준 중력 가속도 g_n(m/s², 정의값, CGPM 1901). https://physics.nist.gov/cgi-bin/cuu/Value?gn 의 "9.806 65 m s⁻²".
// 3b는 로봇이 바닥 평면에 있으므로(높이·롤·피치 0) 로봇 좌표의 중력이 늘 (0, 0, −GRAVITY)다.
export const GRAVITY = 9.80665
