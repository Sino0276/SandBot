/* Copyright (c) 2014, 2015 Qualcomm Technologies Inc

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted (subject to the limitations in the disclaimer below) provided that
the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of Qualcomm Technologies Inc nor the names of its contributors
may be used to endorse or promote products derived from this software without
specific prior written permission.

NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS
LICENSE. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */
// SandBot: 사이드카에는 이벤트 루프의 OpMode 관리자가 없다(런타임이 SandbotOpModeBridge로 OpMode를 돌린다). API 표면은 실제와 같게 두고, 실제 동작이 필요한 ForceStopException(terminateOpModeNow)·DefaultOpMode·정적 도움 함수와 OpMode 수명 알림(registerListener·unregisterListener, getOpModeManagerOfActivity가 주는 관리자 하나)만 실제 코드이며, 나머지 관리자 인스턴스 동작은 생성한 stub처럼 SimUnsupportedException을 던진다.

package com.qualcomm.robotcore.eventloop.opmode;

import android.app.Activity;
import android.content.Context;

import com.qualcomm.robotcore.eventloop.EventLoopManager;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.LightSensor;
import com.qualcomm.robotcore.hardware.RobotCoreLynxUsbDevice;
import com.qualcomm.robotcore.hardware.ServoController;
import com.qualcomm.robotcore.robocol.TelemetryMessage;
import com.qualcomm.robotcore.robot.RobotState;
import com.qualcomm.robotcore.util.ElapsedTime;
import com.qualcomm.robotcore.util.WeakReferenceSet;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.sim.TimeRedirects;

import java.util.ArrayList;
import java.util.List;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link OpModeManagerImpl} is the owner of the concept of a 'current' OpMode.
 */
@SuppressWarnings("unused,WeakerAccess")
public class OpModeManagerImpl implements OpModeServices, OpModeManagerNotifier {

  //------------------------------------------------------------------------------------------------
  // Types
  //------------------------------------------------------------------------------------------------

  // SandBot: nextOpModeState 필드의 형식으로만 남긴다
  class OpModeStateTransition {
  }

  private static SimUnsupportedException unsupported(String method) {
    return new SimUnsupportedException("com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl#" + method);
  }

  //-----------------------------------------------------------------------------------------------
  // Static state and methods
  //-----------------------------------------------------------------------------------------------

  protected static int              matchNumber                     = 0;
  protected static volatile boolean preventDangerousHardwareAccess  = false;

  public static boolean shouldPreventDangerousHardwareAccess() {
    return preventDangerousHardwareAccess;
  }

  //------------------------------------------------------------------------------------------------
  // State
  //------------------------------------------------------------------------------------------------

  public static final String TAG = "OpModeManager";

  public static final String DEFAULT_OP_MODE_NAME    = OpModeManager.DEFAULT_OP_MODE_NAME;

  protected enum OpModeState { INIT, LOOPING }

  protected Context               context;
  protected String                activeOpModeName     = DEFAULT_OP_MODE_NAME;
  protected OpModeInternal        activeOpMode         = null;
  protected OpModeMeta            queuedOpModeMetadata = null; // SandBot: 실제는 RegisteredOpModes.DEFAULT_OP_MODE_METADATA
  protected HardwareMap           hardwareMap          = null;
  protected EventLoopManager      eventLoopManager     = null;
  protected final WeakReferenceSet<OpModeManagerNotifier.Notifications> listeners = new WeakReferenceSet<OpModeManagerNotifier.Notifications>();
  // SandBot: 알리는 순서는 등록 순서다(WeakReferenceSet은 WeakHashMap이라 순서가 실행마다 달라질 수 있다). 실행은 JVM 하나라 강한 참조로 둔다.
  private final List<OpModeManagerNotifier.Notifications> orderedListeners = new ArrayList<OpModeManagerNotifier.Notifications>();
  protected OpModeStuckCodeMonitor stuckMonitor        = null;
  protected boolean               peerWasConnected     = false; // SandBot: 실제는 NetworkConnectionHandler의 연결 상태

  protected OpModeState           opModeState          = OpModeState.INIT;
  protected boolean               opModeSwapNeeded     = false;
  protected boolean               callToInitNeeded     = false;
  protected boolean               callToStartNeeded    = false;
  protected boolean               gamepadResetNeeded   = false;
  protected boolean               telemetryClearNeeded = false;
  protected AtomicReference<OpModeStateTransition> nextOpModeState = new AtomicReference<OpModeStateTransition>(null);

  protected static final WeakHashMap<Activity,OpModeManagerImpl> mapActivityToOpModeManager = new WeakHashMap<Activity,OpModeManagerImpl>();

  //------------------------------------------------------------------------------------------------
  // Construction
  //------------------------------------------------------------------------------------------------

  public OpModeManagerImpl(Activity activity, HardwareMap hardwareMap) {
    throw unsupported("<init>(android.app.Activity,com.qualcomm.robotcore.hardware.HardwareMap)");
  }

  // SandBot: 사이드카의 관리자 하나(SandbotOpModeBridge.manager). 실제 생성자의 기본 OpMode 시작·Activity 등록은 없다.
  OpModeManagerImpl() {
  }

  private static final OpModeManagerImpl SANDBOT_MANAGER = new OpModeManagerImpl();

  static OpModeManagerImpl sandbotManager() {
    return SANDBOT_MANAGER;
  }

  public static OpModeManagerImpl getOpModeManagerOfActivity(Activity activity) {
    // SandBot: Activity가 없다(AppUtil.getActivity()는 null). 어느 Activity로 물어도 사이드카의 관리자다.
    return SANDBOT_MANAGER;
    }

  public void init(EventLoopManager eventLoopManager) {
    throw unsupported("init(com.qualcomm.robotcore.eventloop.EventLoopManager)");
  }

  public void teardown() {
    throw unsupported("teardown()");
  }

  //------------------------------------------------------------------------------------------------
  // Notifications
  //------------------------------------------------------------------------------------------------

  @Override
  public OpMode registerListener(OpModeManagerNotifier.Notifications listener) {
    checkThread();
    synchronized (this.listeners) {
      this.listeners.add(listener);
      // SandBot: 같은 것(equals)은 한 번만(WeakReferenceSet과 같다)
      if (!orderedListeners.contains(listener)) orderedListeners.add(listener);
      return (OpMode) this.activeOpMode;
    }
  }

  @Override
  public void unregisterListener(OpModeManagerNotifier.Notifications listener) {
    checkThread();
    synchronized (this.listeners) {
      this.listeners.remove(listener);
      orderedListeners.remove(listener);
    }
  }

  // SandBot: 1단계는 OpMode 스레드 하나만 SDK를 쓴다(다른 스레드면 가상 시계가 error thread로 알리고 SimThreadError를 던진다)
  private static void checkThread() {
    if (Sim.installed()) Sim.nanoTime();
  }

  // SandBot: 런타임(SandbotOpModeBridge)이 OpMode 수명마다 부른다. 실제 callActiveOpModeInit·Start·Stop처럼 등록한 리스너(등록 순서)
  // 다음에 hardwareMap의 장치 중 Notifications인 것. activeOpMode는 실제 setActiveOpMode처럼 registerListener가 돌려주는 값이다.
  void sandbotSetActiveOpMode(OpMode opMode) {
    synchronized (this.listeners) {
      this.activeOpMode = opMode;
    }
  }

  void sandbotNotify(int which, OpMode opMode, HardwareMap map) {
    List<OpModeManagerNotifier.Notifications> current;
    synchronized (this.listeners) {
      current = new ArrayList<OpModeManagerNotifier.Notifications>(orderedListeners);
    }
    for (OpModeManagerNotifier.Notifications listener : current) {
      notifyOne(listener, which, opMode);
    }
    if (map == null) return;
    for (HardwareDevice device : map.unsafeIterable()) {
      if (device instanceof OpModeManagerNotifier.Notifications) {
        notifyOne((OpModeManagerNotifier.Notifications) device, which, opMode);
      }
    }
  }

  private static void notifyOne(OpModeManagerNotifier.Notifications listener, int which, OpMode opMode) {
    switch (which) {
      case 0: listener.onOpModePreInit(opMode); break;
      case 1: listener.onOpModePreStart(opMode); break;
      default: listener.onOpModePostStop(opMode); break;
    }
  }

  protected void setActiveOpMode(OpMode opMode, String activeOpModeName) {
    throw unsupported("setActiveOpMode(com.qualcomm.robotcore.eventloop.opmode.OpMode,java.lang.String)");
  }

  //------------------------------------------------------------------------------------------------
  // Accessors
  //------------------------------------------------------------------------------------------------

  public void setHardwareMap(HardwareMap hardwareMap) {
    throw unsupported("setHardwareMap(com.qualcomm.robotcore.hardware.HardwareMap)");
  }

  public HardwareMap getHardwareMap() {
    throw unsupported("getHardwareMap()");
  }

  public RobotState getRobotState() {
    throw unsupported("getRobotState()");
  }

  //------------------------------------------------------------------------------------------------
  // OpMode management
  //------------------------------------------------------------------------------------------------

  public String getActiveOpModeName() {
    throw unsupported("getActiveOpModeName()");
  }

  public OpMode getActiveOpMode() {
    throw unsupported("getActiveOpMode()");
  }

  protected void doMatchLoggingWork(String opModeName, boolean isSystemOpMode) {
    throw unsupported("doMatchLoggingWork(java.lang.String,boolean)");
  }

  public void setMatchNumber(int matchNumber) {
    throw unsupported("setMatchNumber(int)");
  }

  public void initOpMode(String opModeName) {
    throw unsupported("initOpMode(java.lang.String)");
  }

  public void initOpMode(String opModeName, boolean onlyInitIfDefaultIsRunning) {
    throw unsupported("initOpMode(java.lang.String,boolean)");
  }

  public void startActiveOpMode() {
    throw unsupported("startActiveOpMode()");
  }

  public void stopActiveOpMode() {
    throw unsupported("stopActiveOpMode()");
  }

  public void runActiveOpMode(Gamepad[] opModeGamepads, Gamepad latestGamepad1Data, Gamepad latestGamepad2Data) {
    throw unsupported("runActiveOpMode(com.qualcomm.robotcore.hardware.Gamepad[],com.qualcomm.robotcore.hardware.Gamepad,com.qualcomm.robotcore.hardware.Gamepad)");
  }

  protected void resetHardwareForOpMode() {
    throw unsupported("resetHardwareForOpMode()");
  }

  protected void callActiveOpModeStop() {
    throw unsupported("callActiveOpModeStop()");
  }

  protected void detectStuck(int msTimeout, String method, Runnable runnable) {
    throw unsupported("detectStuck(int,java.lang.String,java.lang.Runnable)");
  }

  protected void detectStuck(int msTimeout, String method, Runnable runnable, boolean resetDebuggerCheck) {
    throw unsupported("detectStuck(int,java.lang.String,java.lang.Runnable,boolean)");
  }

  public static class ForceStopException extends RuntimeException {}

  /** A utility class that detects infinite loops in user code */
  protected class OpModeStuckCodeMonitor {

    public void startMonitoring(int msTimeout, String method, boolean resetDebuggerCheck) {
      throw unsupported("OpModeStuckCodeMonitor.startMonitoring(int,java.lang.String,boolean)");
    }

    public void stopMonitoring() {
      throw unsupported("OpModeStuckCodeMonitor.stopMonitoring()");
    }

    public void shutdown() {
      throw unsupported("OpModeStuckCodeMonitor.shutdown()");
    }

    protected boolean checkForDebugger() {
      throw unsupported("OpModeStuckCodeMonitor.checkForDebugger()");
    }

    protected class Runner implements Runnable {
      @Override public void run() {
        throw unsupported("OpModeStuckCodeMonitor.Runner.run()");
      }
    }
  }

  protected void callActiveOpModeInit() {
    throw unsupported("callActiveOpModeInit()");
  }

  protected void callActiveOpModeStart() {
    throw unsupported("callActiveOpModeStart()");
  }

  protected void checkOnActiveOpMode() {
    throw unsupported("checkOnActiveOpMode()");
  }

  protected void handleUserCodeException(Exception e) {
    throw unsupported("handleUserCodeException(java.lang.Exception)");
  }

  protected void handleSendStacktrace(Exception e) {
    throw unsupported("handleSendStacktrace(java.lang.Exception)");
  }

  //------------------------------------------------------------------------------------------------
  // OpModeServices
  //------------------------------------------------------------------------------------------------

  /** For the use of {@link org.firstinspires.ftc.robotcore.internal.opmode.TelemetryImpl}. */
  public static void updateTelemetryNow(OpMode opMode, TelemetryMessage telemetry) {
    opMode.internalUpdateTelemetryNow(telemetry);
  }

  @Override public void refreshUserTelemetry(TelemetryMessage telemetry, double sInterval) {
    throw unsupported("refreshUserTelemetry(com.qualcomm.robotcore.robocol.TelemetryMessage,double)");
  }

  /**
   * Requests that an OpMode be stopped.
   * @see OpMode#requestOpModeStop()
   */
  @Override public void requestOpModeStop(OpMode opModeToStopIfActive) {
    throw unsupported("requestOpModeStop(com.qualcomm.robotcore.eventloop.opmode.OpMode)");
    }

  //------------------------------------------------------------------------------------------------
  // Default OpMode
  //------------------------------------------------------------------------------------------------

  /**
   * {@link DefaultOpMode} is the OpMode that the system runs when no user OpMode is active.
   * Note that it's not necessarily the case that this OpMode runs when a user OpMode stops: there
   * are situations in which we can transition directly for one user OpMode to another.
   */
  @SuppressWarnings("WeakerAccess")
  public static class DefaultOpMode extends OpMode {

    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    private static final long SAFE_WAIT_NANOS = 100 * ElapsedTime.MILLIS_IN_NANO;  //  100 mSec = 100,000,000 nSec

    private long nanoNextSafe;
    private boolean firstTimeRun = true;
    private ElapsedTime blinkerTimer = new ElapsedTime();

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    public DefaultOpMode() {
      firstTimeRun = true;
    }

    //----------------------------------------------------------------------------------------------
    // Loop operations
    //----------------------------------------------------------------------------------------------

    @Override
    public void init() {
      startSafe();
      telemetry.addData("Status", "Robot is stopping");
    }

    @Override
    public void init_loop() {
      staySafe();
      telemetry.addData("Status", "Robot is stopped");
    }

    @Override
    public void loop() {
      staySafe();
      telemetry.addData("Status", "Robot is stopped");
    }

    @Override
    public void stop() {
      // take no action
    }

    private boolean isLynxDevice(HardwareDevice device) {
      return device.getManufacturer() == HardwareDevice.Manufacturer.Lynx;
    }
    private boolean isLynxDevice(Object o) {
      return isLynxDevice((HardwareDevice)o);
    }

    /***
     * Initiate the robot safe mode by setting motors off (including CR Servos)
     */
    private void startSafe()  {

      // Set all motor powers to zero. The implementation here will also stop any CRServos.
      for (DcMotorSimple motor : hardwareMap.getAll(DcMotorSimple.class)) {
        // Avoid enabling servos if they are already zero power
        if (motor.getPower() != 0)
          motor.setPower(0);
      }

      // Determine how long to wait before we send disables
      // First time this is run after starting the app should be very short to avoid a glitch
      if (firstTimeRun) {
        firstTimeRun = false;
        nanoNextSafe = TimeRedirects.nanoTime();
        blinkerTimer.reset();
      }
      else
        nanoNextSafe = TimeRedirects.nanoTime() + SAFE_WAIT_NANOS;
    }

    /***
     *  Maintain a safe robot by periodically setting all output devices to safe state
     */
    private void staySafe() {
      // periodically set:
      //  DcMotor run mode to something reasonable
      //  Servos to disabled
      //  LEDs to off

      if (TimeRedirects.nanoTime() > nanoNextSafe) {

        // shutdown all lynx devices. that's all we need to do for these devices
        for (RobotCoreLynxUsbDevice device : hardwareMap.getAll(RobotCoreLynxUsbDevice.class)) {
          device.failSafe();
        }

        // power down the servos
        for (ServoController servoController : hardwareMap.getAll(ServoController.class)) {
          if (!isLynxDevice(servoController)) {
            servoController.pwmDisable();
          }
        }

        // Set motors to safe state
        for (DcMotor dcMotor : hardwareMap.getAll(DcMotor.class)) {
          if (!isLynxDevice(dcMotor)) {
            dcMotor.setPower(0.0);
            dcMotor.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
          }
        }

        // turn of light sensors
        for (LightSensor light : hardwareMap.getAll(LightSensor.class)) {
          light.enableLed(false);
        }

        // Restart the safe timer
        nanoNextSafe = TimeRedirects.nanoTime() + SAFE_WAIT_NANOS;
      }
    }
  }
}
