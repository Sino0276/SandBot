package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

/**
 * DFRobot HuskyLens의 I2C 프로토콜 흉내(명령 패킷 0x55 0xAA 0x11 …, 마지막 바이트는 합 체크섬). 실제 드라이버(HuskyLens)가
 * 보내는 명령에 같은 모양으로 답한다: knock → OK(0x2E), blocks·arrows 요청 → 정보 패킷(0x29, 개수 0). 1단계는 인식 결과가 없어
 * 블록·화살표가 0개다(입력 키는 2단계가 정한다). 고른 알고리즘은 출력 algorithm으로 내보낸다.
 */
final class HuskyLensChip implements SimI2cChip {
    static final String KIND = "huskyLens";

    private static final int CMD_REQUEST_KNOCK = 0x2C, CMD_REQUEST_ALGORITHM = 0x2D, CMD_RESP_OK = 0x2E, CMD_RESP_INFO = 0x29;

    private final SimDevice device;
    private int lastCommand = -1;

    HuskyLensChip(SimDevice device) {
        this.device = device;
        device.output("algorithm", null);
    }

    @Override public byte[] read(int reg, int count) {
        byte[] packet;
        if (reg == 0) {
            // readInfo(): 블록·화살표 개수 정보(learned 0, frame 0)
            packet = packet(CMD_RESP_INFO, new byte[10]);
        } else if (lastCommand == CMD_REQUEST_KNOCK || lastCommand == CMD_REQUEST_ALGORITHM) {
            packet = packet(CMD_RESP_OK, new byte[0]);
        } else {
            packet = new byte[0];
        }
        byte[] out = new byte[count];
        System.arraycopy(packet, 0, out, 0, Math.min(count, packet.length));
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        if (data.length >= 5 && (data[0] & 0xFF) == 0x55 && (data[1] & 0xFF) == 0xAA) {
            lastCommand = data[4] & 0xFF;
            if (lastCommand == CMD_REQUEST_ALGORITHM && data.length >= 6) {
                device.output("algorithm", algorithmName(data[5] & 0xFF));
            }
        }
    }

    private static String algorithmName(int code) {
        switch (code) {
            case 0x00: return "FACE_RECOGNITION";
            case 0x01: return "OBJECT_TRACKING";
            case 0x02: return "OBJECT_RECOGNITION";
            case 0x03: return "LINE_TRACKING";
            case 0x04: return "COLOR_RECOGNITION";
            case 0x05: return "TAG_RECOGNITION";
            case 0x06: return "OBJECT_CLASSIFICATION";
            default: return "NONE";
        }
    }

    private static byte[] packet(int command, byte[] payload) {
        byte[] p = new byte[6 + payload.length];
        p[0] = 0x55;
        p[1] = (byte) 0xAA;
        p[2] = 0x11;
        p[3] = (byte) payload.length;
        p[4] = (byte) command;
        System.arraycopy(payload, 0, p, 5, payload.length);
        int sum = 0;
        for (int i = 0; i < p.length - 1; i++) sum += p[i] & 0xFF;
        p[p.length - 1] = (byte) sum;
        return p;
    }
}
