package org.sandbot.sdk.core;

import com.qualcomm.robotcore.hardware.Gamepad;

import org.firstinspires.ftc.robotcore.internal.ui.GamepadUser;

import java.util.Map;

/**
 * 호스트가 tickReply로 보낸 게임패드 상태(src/shared/sidecarProtocol.ts의 GamepadState)를 SDK의 Gamepad 자료로 만든다.
 * 실제 Robot Controller가 Driver Station에서 받은 게임패드 패킷으로 만드는 "최신 자료"에 해당한다. 사용자에게 보이는
 * gamepad1·gamepad2에는 OpMode의 newGamepadDataAvailable이 copy로 넣는다(엣지 감지·별칭·트리거 눌림은 그때 계산된다).
 */
public final class SandbotGamepads {
    private SandbotGamepads() {}

    /** GamepadState의 실수 키(스틱 −1..1, 위로 밀면 y가 음수; 트리거 0..1) */
    public static final String[] AXES = {
        "left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y", "left_trigger", "right_trigger"
    };

    /** GamepadState의 버튼 키 */
    public static final String[] BUTTONS = {
        "dpad_up", "dpad_down", "dpad_left", "dpad_right", "a", "b", "x", "y", "guide", "start", "back",
        "left_bumper", "right_bumper", "left_stick_button", "right_stick_button", "touchpad"
    };

    /**
     * @param state GamepadState(키 → Number·Boolean). null이면 연결되지 않은 게임패드(모든 값 0, id = ID_UNASSOCIATED).
     * @param user 1 또는 2(gamepad1·gamepad2)
     * @param timestampMillis 상태를 받은 시각(SystemClock.uptimeMillis 기준, 가상)
     */
    public static Gamepad fromState(Map<String, ?> state, int user, long timestampMillis) {
        Gamepad g = new Gamepad();
        if (state == null) return g;
        g.left_stick_x = axis(state, "left_stick_x");
        g.left_stick_y = axis(state, "left_stick_y");
        g.right_stick_x = axis(state, "right_stick_x");
        g.right_stick_y = axis(state, "right_stick_y");
        g.left_trigger = axis(state, "left_trigger");
        g.right_trigger = axis(state, "right_trigger");
        g.dpad_up = button(state, "dpad_up");
        g.dpad_down = button(state, "dpad_down");
        g.dpad_left = button(state, "dpad_left");
        g.dpad_right = button(state, "dpad_right");
        g.a = button(state, "a");
        g.b = button(state, "b");
        g.x = button(state, "x");
        g.y = button(state, "y");
        g.guide = button(state, "guide");
        g.start = button(state, "start");
        g.back = button(state, "back");
        g.left_bumper = button(state, "left_bumper");
        g.right_bumper = button(state, "right_bumper");
        g.left_stick_button = button(state, "left_stick_button");
        g.right_stick_button = button(state, "right_stick_button");
        g.touchpad = button(state, "touchpad");
        // DS가 붙이는 사용자(1·2)와 장치 id. 연결된 게임패드는 id가 ID_UNASSOCIATED가 아니다(팀 코드가 연결을 이렇게 확인한다).
        g.setUser(user == 2 ? GamepadUser.TWO : GamepadUser.ONE);
        g.setGamepadId(user);
        g.setTimestamp(timestampMillis);
        return g;
    }

    private static float axis(Map<String, ?> state, String key) {
        Object v = state.get(key);
        if (!(v instanceof Number)) return 0f;
        float f = ((Number) v).floatValue();
        return Float.isNaN(f) ? 0f : f;
    }

    private static boolean button(Map<String, ?> state, String key) {
        return Boolean.TRUE.equals(state.get(key));
    }
}
