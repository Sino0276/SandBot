package org.sandbot.sdk.devices;

/**
 * I2C 칩의 레지스터 흉내. 실제 드라이버 코드(Pinpoint·OTOS·OctoQuad·HuskyLens·REV Color Sensor V3)를 거의 그대로 두고
 * 아래에서 칩만 흉내 내면, 드라이버의 캐시·변환·오류 처리와 I2C 트랜잭션 수가 실제와 같아진다.
 * {@link SimI2cDeviceSynch}가 read·write 한 번마다 I2C 트랜잭션 하나를 청구하고 이 인터페이스로 넘긴다.
 */
interface SimI2cChip {
    /** 레지스터 없이 읽는 트랜잭션의 register 값 */
    int NO_REGISTER = -1;

    /** register부터 count 바이트를 읽는다(여러 바이트면 보통 다음 레지스터로 이어진다) */
    byte[] read(int register, int count);

    /** register부터 data를 쓴다 */
    void write(int register, byte[] data);
}
