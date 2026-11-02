/* MIT License

Copyright (c) 2018-2022 ACME Robotics

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE. */
// SandBot: FTC Dashboard 0.6.0의 FtcDashboard(dashboard-0.6.0-sources.jar)를 사이드카용으로 옮긴 것. 공개 API는 실제와 같다
// (빌드의 ApiCheck). 웹 서버·웹 소켓·스레드·안드로이드 화면·DashboardCore가 없다: DashboardCore가 하던 전송 대기열과 설정 트리를
// 이 클래스가 OpMode 스레드에서 들고, 런타임이 틱 경계마다 SandbotDashboardHooks(sim의 SimDashboard)로 모아 호스트에 보낸다
// (전송 간격은 가상 시계). 카메라·이미지는 아무것도 하지 않고 안내를 한 번 보낸다.

package com.acmerobotics.dashboard;

import android.content.Context;
import android.graphics.Bitmap;
import android.view.Menu;
import com.acmerobotics.dashboard.config.ValueProvider;
import com.acmerobotics.dashboard.config.variable.BasicVariable;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.message.redux.ReceiveGamepadState;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.ftccommon.FtcEventLoop;
import com.qualcomm.hardware.limelightvision.Limelight3A;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.util.WebHandlerManager;
import java.util.ArrayList;
import java.util.List;
import org.firstinspires.ftc.ftccommon.external.OnCreate;
import org.firstinspires.ftc.ftccommon.external.OnCreateEventLoop;
import org.firstinspires.ftc.ftccommon.external.OnCreateMenu;
import org.firstinspires.ftc.ftccommon.external.OnDestroy;
import org.firstinspires.ftc.ftccommon.external.WebHandlerRegistrar;
import org.firstinspires.ftc.robotcore.external.Func;
import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.robotcore.external.stream.CameraStreamSource;
import org.sandbot.sim.Sim;
import org.xmlpull.v1.XmlPullParser;

/**
 * Main class for interacting with the instance.
 */
public class FtcDashboard implements OpModeManagerImpl.Notifications {
    private static final String TAG = "FtcDashboard";

    private static final int DEFAULT_IMAGE_QUALITY = 50; // 0-100

    // SandBot: DashboardCore.DEFAULT_TELEMETRY_TRANSMISSION_INTERVAL
    /*
     * Telemetry packets are batched for transmission and sent at this interval.
     */
    private static final int DEFAULT_TELEMETRY_TRANSMISSION_INTERVAL = 100; // ms

    private static boolean suppressOpMode = false;

    private static final String HARDWARE_CATEGORY = "__hardware__";

    // SandBot: 실제는 start(Context)(@OnCreate, 앱 시작 때)가 만든다. 사이드카에는 앱 수명이 없어 클래스 초기화 때 만든다
    // (런타임이 @OpModeRegistrar보다 먼저 초기화한다). 그래서 getInstance()는 늘 null이 아니다.
    private static FtcDashboard instance = new FtcDashboard();

    static {
        // SandBot: 런타임(DashboardBridge)이 틱 경계마다 부를 것
        Sim.attachDashboard(instance.hooks);
    }

    // SandBot: 사이드카 앱 수명 훅(registerOpMode·start·attachWebServer·attachEventLoop·populateMenu·stop)은 아무것도 하지 않는다.
    // 등록기는 런타임이 TeamCode의 것만 부르므로 "Enable/Disable Dashboard" OpMode는 없다(Dashboard는 늘 켜져 있다).
    @OpModeRegistrar
    public static void registerOpMode(OpModeManager manager) {
    }

    /**
     * Call before start to suppress the enable/disable op mode.
     */
    public static void suppressOpMode() {
        suppressOpMode = true;
    }

    /**
     * Starts the dashboard.
     */
    @OnCreate
    public static void start(Context context) {
    }

    /**
     * Attaches a web server for accessing the dashboard through the phone (like OBJ/Blocks).
     */
    @WebHandlerRegistrar
    public static void attachWebServer(Context context, WebHandlerManager manager) {
    }

    /**
     * Attaches the event loop to the instance for op mode management.
     */
    @OnCreateEventLoop
    public static void attachEventLoop(Context context, FtcEventLoop eventLoop) {
    }

    /**
     * Populates the menu with dashboard enable/disable options.
     *
     * @param menu menu
     */
    @OnCreateMenu
    public static void populateMenu(Context context, Menu menu) {
    }

    /**
     * Stops the instance and the underlying WebSocket server.
     */
    @OnDestroy
    public static void stop(Context context) {
    }

    /**
     * Returns the active instance instance. This should be called after {@link #start(Context)}.
     *
     * @return active instance instance or null outside of its lifecycle
     */
    public static FtcDashboard getInstance() {
        return instance;
    }

    /**
     * @return a boolean indicating if the dashboard is currently active
     */
    public boolean isEnabled() { return enabled; }

    // SandBot: DashboardCore의 상태(core.enabled는 autoEnable 기본값 true, 사이드카에는 끄는 OpMode가 없다)
    boolean enabled = true;
    // 보낼 패킷(전송 간격마다 SandbotDashboardHooks가 모아 보낸다)
    final List<TelemetryPacket> pendingTelemetry = new ArrayList<>();
    int telemetryTransmissionInterval = DEFAULT_TELEMETRY_TRANSMISSION_INTERVAL;
    final Mutex<CustomVariable> configRoot = new Mutex<>(new CustomVariable());
    // SandBot: 기준값(configBaseline)은 Dashboard 웹 화면의 되돌리기용이라 두지 않는다

    private Telemetry telemetry = new TelemetryAdapter();

    private int imageQuality = DEFAULT_IMAGE_QUALITY;

    // only modified inside withConfigRoot
    private final List<String[]> varsToRemove = new ArrayList<>();

    final SandbotDashboardHooks hooks = new SandbotDashboardHooks(this);

    public void deleteRobotConfigFile(String name) {
        // SandBot: 로봇 구성 파일은 TeamCode의 생성 구성이다(지우지 않는다)
    }

    public String xmlPullParserToString(XmlPullParser parser) {
        // SandBot: 하드웨어 구성 편집기(웹)가 없다
        return "";
    }

    /**
     * Adapter to use dashboard telemetry like normal SDK telemetry. Note that this doesn't support
     * all of the operations yet.
     */
    private class TelemetryAdapter implements Telemetry {
        private TelemetryPacket currentPacket;
        private LogAdapter log;

        public TelemetryAdapter() {
            currentPacket = new TelemetryPacket();
            log = new LogAdapter(currentPacket);
        }

        @Override
        public Item addData(String caption, String format, Object... args) {
            return addData(caption, String.format(format, args));
        }

        @Override
        public Item addData(String caption, Object value) {
            currentPacket.put(caption, value);
            return null;
        }

        @Override
        public <T> Item addData(String caption, Func<T> valueProducer) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <T> Item addData(String caption, String format, Func<T> valueProducer) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean removeItem(Item item) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void clear() {
            clearTelemetry();

            currentPacket = new TelemetryPacket();
            log = new LogAdapter(currentPacket);
        }

        @Override
        public void clearAll() {
            clear();
        }

        @Override
        public Object addAction(Runnable action) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean removeAction(Object token) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void speak(String text) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void speak(String text, String languageCode, String countryCode) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean update() {
            sendTelemetryPacket(currentPacket);

            currentPacket = new TelemetryPacket();
            log = new LogAdapter(currentPacket);

            return true;
        }

        @Override
        public Line addLine() {
            return null;
        }

        @Override
        public Line addLine(String lineCaption) {
            currentPacket.addLine(lineCaption);
            return null;
        }

        @Override
        public boolean removeLine(Line line) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean isAutoClear() {
            return false;
        }

        @Override
        public void setAutoClear(boolean autoClear) {
            throw new UnsupportedOperationException();
        }

        @Override
        public int getMsTransmissionInterval() {
            return getTelemetryTransmissionInterval();
        }

        @Override
        public void setMsTransmissionInterval(int msTransmissionInterval) {
            setTelemetryTransmissionInterval(msTransmissionInterval);
        }

        @Override
        public String getItemSeparator() {
            return null;
        }

        @Override
        public void setItemSeparator(String itemSeparator) {

        }

        @Override
        public String getCaptionValueSeparator() {
            return null;
        }

        @Override
        public void setCaptionValueSeparator(String captionValueSeparator) {

        }

        @Override
        public void setDisplayFormat(DisplayFormat displayFormat) {

        }

        @Override
        public Log log() {
            return log;
        }
    }

    private static class LogAdapter implements Telemetry.Log {
        private TelemetryPacket telemetryPacket;

        private LogAdapter(TelemetryPacket packet) {
            telemetryPacket = packet;
        }

        @Override
        public int getCapacity() {
            return 0;
        }

        @Override
        public void setCapacity(int capacity) {

        }

        @Override
        public DisplayOrder getDisplayOrder() {
            return DisplayOrder.OLDEST_FIRST;
        }

        @Override
        public void setDisplayOrder(DisplayOrder displayOrder) {

        }

        @Override
        public void add(String entry) {
            telemetryPacket.addLine(entry);
        }

        @Override
        public void add(String format, Object... args) {
            telemetryPacket.addLine(String.format(format, args));
        }

        @Override
        public void clear() {
            telemetryPacket.clearLines();
        }
    }

    private FtcDashboard() {
        // SandBot: @Config 클래스 찾기(addConfigClasses)는 런타임이 컴파일한 클래스 이름을 주고 부른다
        // (SandbotDashboardHooks.addConfigClasses). 웹 서버·메뉴·상태 표시가 없다.
    }

    /**
     * Queues a telemetry packet to be sent to all clients. Packets are sent in batches of
     * approximate period {@link #getTelemetryTransmissionInterval()}. Clients display the most
     * recent value received for each key, and the data is cleared upon op mode init or a call to
     * {@link #clearTelemetry()}.
     *
     * @param telemetryPacket packet to send
     */
    public void sendTelemetryPacket(TelemetryPacket telemetryPacket) {
        // SandBot: DashboardCore.sendTelemetryPacket. 전송 스레드 대신 런타임이 틱 경계에서 보낸다
        if (!enabled) {
            return;
        }

        telemetryPacket.addTimestamp();

        hooks.checkThread();
        // TODO: a circular buffer is probably a better idea, but this will work for now
        if (pendingTelemetry.size() > 100) {
            return;
        }

        pendingTelemetry.add(telemetryPacket);
    }

    /**
     * Clears telemetry data from all clients.
     */
    public void clearTelemetry() {
        // SandBot: DashboardCore.clearTelemetry. 화면을 지우라는 표시를 다음 경계에 보낸다(dash.cleared)
        hooks.checkThread();
        pendingTelemetry.clear();
        hooks.telemetryCleared();
    }

    /**
     * Returns a {@link Telemetry} object that delegates to the telemetry methods of this class.
     * Beware that the implementation of the interface is incomplete, and users should test each
     * method they intend to use.
     */
    public Telemetry getTelemetry() {
        return telemetry;
    }

    /**
     * Returns the telemetry transmission interval in milliseconds.
     */
    public int getTelemetryTransmissionInterval() {
        return telemetryTransmissionInterval;
    }

    /**
     * Sets the telemetry transmission interval.
     *
     * @param newTransmissionInterval transmission interval in milliseconds
     */
    public void setTelemetryTransmissionInterval(int newTransmissionInterval) {
        telemetryTransmissionInterval = newTransmissionInterval;
    }

    /**
     * Sends updated configuration data to all instance clients.
     */
    public void updateConfig() {
        // SandBot: DashboardCore.updateConfig. 트리 전체를 다음 경계에 보낸다(dashConfig)
        hooks.checkThread();
        hooks.configChanged();
    }

    /**
     * Executes {@param function} in an exclusive context for thread-safe config tree modification
     * and calls {@link #updateConfig()} to keep clients up to date.
     *
     * <p>Do not leak the config tree outside the function.
     *
     * @param function custom variable consumer
     */
    public void withConfigRoot(CustomVariableConsumer function) {
        // SandBot: DashboardCore.withConfigRoot. 바꾸는 동안 경계가 와도 트리를 읽지 않는다(SandbotDashboardHooks)
        hooks.checkThread();
        hooks.beginConfigChange();
        try {
            configRoot.with(function::accept);
        } finally {
            hooks.endConfigChange();
        }

        updateConfig();
    }

    /**
     * Runs {@code function} with the hardware subtree of the configuration root.
     *
     * <p>If the top-level hardware category ("{@value #HARDWARE_CATEGORY}") does not
     * yet exist it will be created. The provided {@link CustomVariableConsumer} is
     * invoked while holding the same exclusive config-root lock used by
     * {@link #withConfigRoot(CustomVariableConsumer)}, so callers may safely modify the
     * hardware config tree inside the consumer. Do not leak references to the
     * config tree outside the consumer.</p>
     *
     * @param function consumer that receives the {@link CustomVariable} representing the
     *                 hardware category and may modify it as needed
     */
    public void withHardwareRoot(CustomVariableConsumer function) {
        withConfigRoot(root -> {
            CustomVariable hardwareVar = (CustomVariable) root.getVariable(HARDWARE_CATEGORY);
            if (hardwareVar == null) {
                hardwareVar = new CustomVariable();
                root.putVariable(HARDWARE_CATEGORY, hardwareVar);
            }
            function.accept(hardwareVar);
        });
    }

    /**
     * Add config variable with custom provider that is automatically removed when op mode ends.
     *
     * @param category top-level category
     * @param name     variable name
     * @param provider getter/setter for the variable
     * @param <T>      variable type
     */
    public <T> void addConfigVariable(String category, String name, ValueProvider<T> provider) {
        // SandBot: DashboardCore.addConfigVariable(기준값 갱신 없이)
        withConfigRoot(v -> {
            CustomVariable catVar = (CustomVariable) v.getVariable(category);
            if (catVar != null) {
                catVar.putVariable(name, new BasicVariable<>(provider));
            } else {
                catVar = new CustomVariable();
                catVar.putVariable(name, new BasicVariable<>(provider));
                v.putVariable(category, catVar);
            }
        });
    }

    /**
     * Add config variable with custom provider.
     *
     * @param category   top-level category
     * @param name       variable name
     * @param provider   getter/setter for the variable
     * @param autoRemove if true, the variable is removed on op mode termination
     * @param <T>        variable type
     */
    public <T> void addConfigVariable(final String category, final String name,
                                      final ValueProvider<T> provider,
                                      final boolean autoRemove) {
        withConfigRoot(new CustomVariableConsumer() {
            @Override
            public void accept(CustomVariable configRoot) {
                addConfigVariable(category, name, provider);

                if (autoRemove) {
                    varsToRemove.add(new String[] {category, name});
                }
            }
        });
    }

    /**
     * Remove a config variable.
     *
     * @param category top-level category
     * @param name     variable name
     */
    public void removeConfigVariable(String category, String name) {
        // SandBot: DashboardCore.removeConfigVariable(분류가 없으면 실제처럼 NullPointerException)
        withConfigRoot(v -> {
            CustomVariable catVar = (CustomVariable) v.getVariable(category);
            catVar.removeVariable(name);
            if (catVar.size() == 0) {
                v.removeVariable(category);
            }
        });
    }

    /**
     * Sends an image to the dashboard for display (MJPEG style). Note that the encoding process is
     * synchronous. Stops the active stream if running.
     *
     * @param bitmap bitmap to send
     */
    public void sendImage(Bitmap bitmap) {
        if (!enabled) {
            return;
        }

        // SandBot: 이미지는 보이지 않는다(안내를 한 번)
        hooks.notice("dashImage");
    }

    /**
     * Sends a stream of camera frames at a regular interval.
     *
     * @param source camera stream source
     * @param maxFps maximum frames per second; 0 indicates unlimited
     */
    public void startCameraStream(CameraStreamSource source, double maxFps) {
        if (!enabled) {
            return;
        }

        // SandBot: 카메라 스트림은 시뮬레이션하지 않는다(source.getFrameBitmap을 부르지 않는다, 안내를 한 번)
        hooks.notice("dashCamera");
    }

    /**
     * Stops the camera frame stream.
     */
    public void stopCameraStream() {
        // SandBot: 스트림이 없다
    }

    /**
     * Sends a stream of camera frames from a Limelight3A camera at a regular interval.
     *
     * @param limelight the Limelight object
     * @param maxFps maximum frames per second; 0 indicates unlimited
     */
    public void startCameraStream(Limelight3A limelight, double maxFps) {
        if (!enabled) {
            return;
        }

        // SandBot: startCameraStream(CameraStreamSource, double)과 같다
        hooks.notice("dashCamera");
    }

    /**
     * Returns the image quality used by {@link #sendImage(Bitmap)} and
     * {@link #startCameraStream(CameraStreamSource, double)}.
     */
    public int getImageQuality() {
        return imageQuality;
    }

    /**
     * Sets the image quality used by {@link #sendImage(Bitmap)} and
     * {@link #startCameraStream(CameraStreamSource, double)}.
     */
    public void setImageQuality(int quality) {
        imageQuality = quality;
    }

    public static void copyIntoSdkGamepad(ReceiveGamepadState.Gamepad src, Gamepad dst) {
        // We need to copy from an intermediate so the SDK can handle the rising/falling edge detection
        // Also, doing it like this means the SDK handles equivalencies between
        // standard and Playstation buttons (i.e. converting A -> Cross and vice versa)
        Gamepad intermediate = new Gamepad();
        intermediate.left_stick_x = src.left_stick_x;
        intermediate.left_stick_y = src.left_stick_y;
        intermediate.right_stick_x = src.right_stick_x;
        intermediate.right_stick_y = src.right_stick_y;

        intermediate.dpad_up = src.dpad_up;
        intermediate.dpad_down = src.dpad_down;
        intermediate.dpad_left = src.dpad_left;
        intermediate.dpad_right = src.dpad_right;

        intermediate.a = src.a;
        intermediate.b = src.b;
        intermediate.x = src.x;
        intermediate.y = src.y;

        intermediate.guide = src.guide;
        intermediate.start = src.start;
        intermediate.back = src.back;

        intermediate.left_bumper = src.left_bumper;
        intermediate.right_bumper = src.right_bumper;

        intermediate.left_stick_button = src.left_stick_button;
        intermediate.right_stick_button = src.right_stick_button;

        intermediate.left_trigger = src.left_trigger;
        intermediate.right_trigger = src.right_trigger;

        intermediate.touchpad = src.touchpad;
        dst.copy(intermediate);
    }

    @Override
    public void onOpModePreInit(OpMode opMode) {
        // SandBot: 런타임(DashboardBridge)이 OpMode를 만든 뒤 init 전에 부른다. 상태 표시(RobotStatus)는 없다.
        if (!(opMode instanceof OpModeManagerImpl.DefaultOpMode)) {
            clearTelemetry();
        }
    }

    @Override
    public void onOpModePreStart(OpMode opMode) {
        // SandBot: 상태 표시(RobotStatus)가 없어 할 일이 없다
    }

    @Override
    public void onOpModePostStop(OpMode opMode) {
        // SandBot: 실제는 새 스레드에서 지운다(이 콜백이 UI 스레드에서 올 때가 있어서). 사이드카는 OpMode 스레드 하나라 그 자리에서
        // 지우고, 이미 없는 분류는 건너뛴다(실제는 그 스레드만 NullPointerException으로 끝난다).
        withConfigRoot(new CustomVariableConsumer() {
            @Override
            public void accept(CustomVariable configRoot) {
                for (String[] var : varsToRemove) {
                    String category = var[0];
                    String name = var[1];
                    CustomVariable catVar =
                        (CustomVariable) configRoot.getVariable(category);
                    if (catVar == null) {
                        continue;
                    }
                    catVar.removeVariable(name);
                    if (catVar.size() == 0) {
                        configRoot.removeVariable(category);
                    }
                }
                varsToRemove.clear();
            }
        });

        stopCameraStream();
    }
}
