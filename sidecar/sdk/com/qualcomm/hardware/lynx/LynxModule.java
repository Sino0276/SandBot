/*
Copyright (c) 2016 Robert Atkinson

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted (subject to the limitations in the disclaimer below) provided that
the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of Robert Atkinson nor the names of his contributors may be used to
endorse or promote products derived from this software without specific prior
written permission.

NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS
LICENSE. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
// SandBot: 실제 API(필드·메서드·중첩 클래스)는 그대로 두고, 허브 상태·BulkCachingMode·비용은 org.sandbot.sdk.devices.SimHub가 맡는다.
// USB·Lynx 프로토콜(명령 전송, ping, 펌웨어 질의, 디버그)은 시뮬레이터에 없으므로 SimUnsupportedException을 던진다.
// SandBot: 끊긴 스레드에서 보내지 못한 명령(SimHub의 비용 메서드가 false)은 실제 catch 블록처럼 자리값·로그·InterruptedException으로 끝난다.
package com.qualcomm.hardware.lynx;

import android.graphics.Color;

import com.qualcomm.hardware.lynx.commands.LynxCommand;
import com.qualcomm.hardware.lynx.commands.LynxDatagram;
import com.qualcomm.hardware.lynx.commands.LynxInterface;
import com.qualcomm.hardware.lynx.commands.LynxMessage;
import com.qualcomm.hardware.lynx.commands.LynxRespondable;
import com.qualcomm.hardware.lynx.commands.LynxResponse;
import com.qualcomm.hardware.lynx.commands.core.LynxDekaInterfaceCommand;
import com.qualcomm.robotcore.exception.RobotCoreException;
import com.qualcomm.robotcore.hardware.Blinker;
import com.qualcomm.robotcore.hardware.HardwareDeviceHealth;
import com.qualcomm.robotcore.hardware.LynxModuleImuType;
import com.qualcomm.robotcore.hardware.VisuallyIdentifiableHardwareDevice;
import com.qualcomm.robotcore.hardware.usb.RobotArmingStateNotifier;
import com.qualcomm.robotcore.util.RobotLog;
import com.qualcomm.robotcore.util.SerialNumber;

import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;
import org.firstinspires.ftc.robotcore.external.navigation.TempUnit;
import org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit;
import org.sandbot.sdk.devices.SimHub;
import org.sandbot.sim.SimUnsupportedException;

import java.lang.reflect.Constructor;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 허브(Control Hub·Expansion Hub) 하나. 시뮬레이터에서는 {@link SimHub}가 만들고, BulkCachingMode·clearBulkCache·
 * getBulkData·failSafe·전압/전류/온도 읽기·LED 색은 실제 의미대로 동작한다.
 */
@SuppressWarnings("WeakerAccess")
public class LynxModule extends LynxCommExceptionHandler implements LynxModuleIntf, RobotArmingStateNotifier, RobotArmingStateNotifier.Callback, Blinker, VisuallyIdentifiableHardwareDevice
    {
    //----------------------------------------------------------------------------------------------
    // Constants
    //----------------------------------------------------------------------------------------------

    public static final String TAG = "LynxModule";
    @Override protected String getTag() { return TAG; }

    public static BlinkerPolicy blinkerPolicy = new CountModuleAddressBlinkerPolicy();

    protected static final int msInitialContact = 500;
    protected static final int msKeepAliveTimeout = 2500;
    protected static final byte moduleStatusPersistentBits = 28;

    /** LynxSetModuleLEDPatternCommand.maxStepCount */
    private static final int MAX_LED_STEPS = 16;

    protected static class MessageClassAndCtor
        {
        public Class<? extends LynxMessage>        clazz;
        public Constructor<? extends LynxMessage>  ctor;

        public void assignCtor() throws NoSuchMethodException
            {
            try {
                this.ctor = this.clazz.getConstructor(LynxModule.class);
                }
            catch (NoSuchMethodException ignored)
                {
                try {
                    this.ctor = this.clazz.getConstructor(LynxModuleIntf.class);
                    }
                catch (NoSuchMethodException e)
                    {
                    this.ctor = null;
                    }
                }
            }
        }

    protected static Map<Integer,MessageClassAndCtor>                       standardMessages = new HashMap<Integer, MessageClassAndCtor>();
    protected static Map<Class<? extends LynxCommand>,MessageClassAndCtor>  responseClasses = new HashMap<Class<? extends LynxCommand>, MessageClassAndCtor>();

    protected static void addStandardMessage(Class<? extends LynxMessage> clazz)
        {
        throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxModule#addStandardMessage(java.lang.Class)");
        }

    protected static void correlateStandardResponse(Class<? extends LynxCommand> commandClass)
        {
        throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxModule#correlateStandardResponse(java.lang.Class)");
        }

    public static void correlateResponse(Class<? extends LynxCommand> commandClass, Class<? extends LynxResponse> responseClass) throws NoSuchMethodException
        {
        throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxModule#correlateResponse(java.lang.Class,java.lang.Class)");
        }

    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    protected LynxUsbDevice                     lynxUsbDevice;
    protected List<LynxController>              controllers;
    protected final Object                      addrAndSerialLock;
    protected int                               moduleAddress;
    protected SerialNumber                      moduleSerialNumber;
    protected AtomicInteger                     nextMessageNumber;
    protected boolean                           isParent;
    protected volatile boolean                  isSystemSynthetic;
    protected volatile boolean                  isUserModule;
    protected int                               systemOperationCounter = 0;
    protected boolean                           isEngaged;
    protected final Object                      engagementLock = new Object();
    protected volatile boolean                  isOpen;
    protected volatile boolean                  isNotResponding = false;
    protected final Object                      startStopLock;

    protected final ConcurrentHashMap<Integer, LynxRespondable>        unfinishedCommands;
    protected final ConcurrentHashMap<Integer, MessageClassAndCtor>    commandClasses;
    protected final Set<Class<? extends LynxCommand>>                  supportedCommands;
    protected final ConcurrentHashMap<String, LynxInterface>           interfacesQueried;
    protected final Object                                             i2cLock;

    protected ArrayList<Step>                   currentSteps;
    protected Deque<ArrayList<Step>>            previousSteps;
    protected boolean                           isVisuallyIdentifying;

    protected ScheduledExecutorService          executor;
    protected Future<?>                         pingFuture;
    protected final Object                      pingFutureLock;
    protected Future<?>                         moduleStatusFuture;
    protected boolean                           attentionRequiredPreviously;
    protected int                               previousModuleStatus;
    protected final Object                      moduleStatusLock;
    protected boolean                           ftdiResetWatchdogActive;
    protected boolean                           ftdiResetWatchdogActiveWhenEngaged;

    protected final Object                                            bulkCachingLock;
    protected BulkCachingMode                                         bulkCachingMode;
    protected Map<String, List<LynxDekaInterfaceCommand<?>>>          bulkCachingHistory;
    protected BulkData                                                lastBulkData;

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    /** 시뮬레이터에서는 SimHub만 부른다(lynxUsbDevice는 null) */
    public LynxModule(LynxUsbDevice lynxUsbDevice, int moduleAddress, boolean isParent, boolean isUserModule)
        {
        this.lynxUsbDevice      = lynxUsbDevice;
        this.controllers        = new CopyOnWriteArrayList<LynxController>();
        this.addrAndSerialLock  = new Object();
        this.moduleAddress      = moduleAddress;
        this.moduleSerialNumber = null;
        this.isParent           = isParent;
        this.isSystemSynthetic  = false;
        this.isEngaged          = true;
        this.isUserModule       = isUserModule;
        this.isOpen             = true;
        this.startStopLock      = new Object();
        this.nextMessageNumber  = new AtomicInteger(0);
        this.commandClasses     = new ConcurrentHashMap<Integer, MessageClassAndCtor>(standardMessages);
        this.supportedCommands  = new HashSet<>();
        this.interfacesQueried  = new ConcurrentHashMap<String, LynxInterface>();
        this.unfinishedCommands = new ConcurrentHashMap<Integer, LynxRespondable>();
        this.i2cLock            = new Object();
        this.currentSteps       = new ArrayList<Step>();
        this.previousSteps      = new ArrayDeque<ArrayList<Step>>();
        this.isVisuallyIdentifying = false;
        this.executor           = null;
        this.pingFuture         = null;
        this.moduleStatusFuture = null;
        this.attentionRequiredPreviously = false;
        this.previousModuleStatus = Integer.MIN_VALUE;
        this.moduleStatusLock   = new Object();
        this.pingFutureLock     = new Object();
        this.ftdiResetWatchdogActive = false;
        this.ftdiResetWatchdogActiveWhenEngaged = false;
        this.bulkCachingMode    = BulkCachingMode.OFF;
        this.bulkCachingHistory = new HashMap<>();
        this.bulkCachingLock    = new Object();
        }

    private SimHub sim()
        {
        SimHub hub = SimHub.of(this);
        if (hub == null) throw new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxModule#<init>(com.qualcomm.hardware.lynx.LynxUsbDevice,int,boolean,boolean)");
        return hub;
        }

    private static SimUnsupportedException unsupported(String method)
        {
        return new SimUnsupportedException("com.qualcomm.hardware.lynx.LynxModule#" + method);
        }

    /**
     * SandBot: 끊긴 스레드라 보내지 못한 명령의 예외. 실제 LynxRespondable.send·sendReceive의 MessageKeyedLock.acquire는
     * lockInterruptibly라 끊김 표시를 지우고 InterruptedException을 낸다. SimHub는 표시를 남겨 둔다(컨트롤러의 handleException이 다시
     * 세우는 경우와 결과가 같으므로). 그 예외가 handleException을 거치지 않는 곳(throws InterruptedException으로 넘기거나 직접 잡는
     * 곳)은 실제처럼 여기서 표시를 지운다.
     */
    private static InterruptedException lockInterrupted()
        {
        Thread.interrupted();
        return new InterruptedException();
        }

    @Override public String toString()
        {
        return String.format("LynxModule(mod#=%d, serial=%s)", getModuleAddress(), "(embedded)");
        }

    @Override public void close()
        {
        isOpen = false;
        }

    public boolean isOpen()
        {
        return isOpen;
        }

    public boolean isUserModule()
        {
        return isUserModule;
        }

    public void setUserModule(boolean isUserModule)
        {
        this.isUserModule = isUserModule;
        }

    public boolean isSystemSynthetic()
        {
        return isSystemSynthetic;
        }

    public void setSystemSynthetic(boolean systemSynthetic)
        {
        isSystemSynthetic = systemSynthetic;
        }

    public void noteController(LynxController controller)
        {
        this.controllers.add(controller);
        }

    /**
     * Expansion Hub·Control Hub의 제품 번호(LynxConstants.EXPANSION_HUB_PRODUCT_NUMBER). 실제는 SERVO_HUB 인터페이스를 묻고
     * NACK이면(Expansion Hub·Control Hub) 이 값이다. 끊긴 스레드면 실제처럼 catch (InterruptedException)이 끊김이 지워진 채 로그를
     * 남기고 같은 값을 돌려준다(그래서 뒤의 명령은 다시 간다).
     */
    public int getRevProductNumber()
        {
        if (!sim().lynxCommand()) // LynxQueryInterfaceCommand(SERVO_HUB)
            {
            RobotLog.ee(TAG, lockInterrupted(), "Failed to determine the REV product number");
            }
        return 3215698;
        }

    public int getModuleAddress()
        {
        return this.moduleAddress;
        }

    public void setNewModuleAddress(int newModuleAddress)
        {
        throw unsupported("setNewModuleAddress(int)");
        }

    protected byte getNewMessageNumber()
        {
        return (byte) nextMessageNumber.incrementAndGet();
        }

    @Override public void setAttentionRequired(boolean attentionRequired)
        {
        }

    protected void noteDatagramReceived()
        {
        }

    public void noteNotResponding()
        {
        isNotResponding = true;
        }

    public boolean isNotResponding()
        {
        return isNotResponding;
        }

    protected void warnIfClosed()
        {
        }

    protected void stopAttentionRequired()
        {
        }

    protected void sendGetModuleStatusAndProcessResponse(boolean clearStatus)
        {
        if (!sim().lynxCommand()) return; // LynxGetModuleStatusCommand. 끊김: 실제 catch → handleException(다시 끊음)
        }

    protected void forgetLastKnown()
        {
        for (LynxController controller : this.controllers)
            {
            controller.forgetLastKnown();
            }
        }

    //----------------------------------------------------------------------------------------------
    // HardwareDevice
    //----------------------------------------------------------------------------------------------

    @Override public Manufacturer getManufacturer()
        {
        return Manufacturer.Lynx;
        }

    @Override public String getDeviceName()
        {
        return String.format("%s (%s)", "Expansion Hub", getFirmwareVersionString());
        }

    @Override public String getFirmwareVersionString()
        {
        String result = getNullableFirmwareVersionString();
        return result == null ? "firmware version unavailable" : result;
        }

    /** LynxReadVersionStringCommand 하나. 지금 REV 허브 펌웨어(1.8.2)의 문자열 모양이다. 끊긴 스레드면 실제처럼 null. */
    @Override public String getNullableFirmwareVersionString()
        {
        if (!sim().lynxCommand()) return null; // 끊김: 실제 catch → handleException(다시 끊음) 뒤 null
        return "HW: 20, Maj: 1, Min: 8, Eng: 2";
        }

    @Override public String getConnectionInfo()
        {
        return String.format("%s; module %d", "USB (embedded)", this.getModuleAddress());
        }

    @Override public int getVersion()
        {
        return 1;
        }

    /** OpMode마다(실제와 같음): BulkCachingMode를 OFF로 */
    @Override public void resetDeviceConfigurationForOpMode()
        {
        setBulkCachingMode(BulkCachingMode.OFF);
        }

    /** 컨트롤러 건강 상태에서 나온 경고. 시뮬레이터의 컨트롤러는 늘 건강하므로 비어 있다. */
    public List<String> getGlobalWarnings()
        {
        return new ArrayList<String>();
        }

    public static String getHealthStatusWarningMessage(HardwareDeviceHealth hardwareDeviceHealth)
        {
        switch (hardwareDeviceHealth.getHealthStatus())
            {
            case UNHEALTHY:
                String name = hardwareDeviceHealth instanceof com.qualcomm.robotcore.hardware.HardwareDevice
                        ? ((com.qualcomm.robotcore.hardware.HardwareDevice) hardwareDeviceHealth).getDeviceName()
                        : hardwareDeviceHealth.toString();
                return String.format("%s is unhealthy", name);
            default:
                return "";
            }
        }

    /** 허브 일련번호(SerialNumber)는 이 시뮬레이터에서 만들 수 없다 */
    public SerialNumber getModuleSerialNumber()
        {
        throw unsupported("getModuleSerialNumber()");
        }

    @Override public SerialNumber getSerialNumber()
        {
        throw unsupported("getSerialNumber()");
        }

    //----------------------------------------------------------------------------------------------
    // Arming and disarming
    //----------------------------------------------------------------------------------------------

    @Override public ARMINGSTATE getArmingState()
        {
        return ARMINGSTATE.ARMED;
        }

    @Override public void registerCallback(Callback callback, boolean doInitialCallback)
        {
        if (doInitialCallback) callback.onModuleStateChange(this, getArmingState());
        }

    @Override public void unregisterCallback(Callback callback)
        {
        }

    @Override public void onModuleStateChange(RobotArmingStateNotifier module, ARMINGSTATE state)
        {
        }

    //----------------------------------------------------------------------------------------------
    // Engagable
    //----------------------------------------------------------------------------------------------

    @Override public void engage()
        {
        synchronized (engagementLock) { isEngaged = true; }
        }

    @Override public void disengage()
        {
        synchronized (engagementLock) { isEngaged = false; }
        }

    @Override public boolean isEngaged()
        {
        synchronized (engagementLock) { return isEngaged; }
        }

    //----------------------------------------------------------------------------------------------
    // Blinker (허브 LED). 패턴을 보낼 때마다 LynxSetModuleLEDPatternCommand 하나.
    //----------------------------------------------------------------------------------------------

    @Override public void visuallyIdentify(boolean shouldIdentify)
        {
        synchronized (this)
            {
            if (this.isVisuallyIdentifying != shouldIdentify)
                {
                if (shouldIdentify) internalPushPattern(blinkerPolicy.getVisuallyIdentifyPattern(this));
                else popPattern();
                this.isVisuallyIdentifying = shouldIdentify;
                }
            }
        }

    @Override public int getBlinkerPatternMaxLength()
        {
        return MAX_LED_STEPS;
        }

    @Override public void setConstant(int color)
        {
        Step step = new Step(color, 1, TimeUnit.SECONDS);
        List<Step> steps = new ArrayList<Step>();
        steps.add(step);
        setPattern(steps);
        }

    @Override public void stopBlinking()
        {
        setConstant(Color.BLACK);
        }

    @Override public synchronized void setPattern(Collection<Step> steps)
        {
        this.currentSteps = steps == null ? new ArrayList<Step>() : new ArrayList<Step>(steps);
        sendLEDPatternSteps(this.currentSteps);
        }

    @Override public synchronized Collection<Step> getPattern()
        {
        return new ArrayList<Step>(this.currentSteps);
        }

    protected void resendCurrentPattern()
        {
        sendLEDPatternSteps(this.currentSteps);
        }

    @Override public synchronized void pushPattern(Collection<Step> steps)
        {
        visuallyIdentify(false);
        internalPushPattern(steps);
        }

    protected void internalPushPattern(Collection<Step> steps)
        {
        this.previousSteps.push(this.currentSteps);
        setPattern(steps);
        }

    @Override public synchronized boolean patternStackNotEmpty()
        {
        return this.previousSteps.size() > 0;
        }

    @Override public synchronized boolean popPattern()
        {
        try {
            setPattern(previousSteps.pop());
            return true;
            }
        catch (NoSuchElementException e)
            {
            setPattern(null);
            }
        return false;
        }

    private void sendLEDPatternSteps(Collection<Step> steps)
        {
        SimHub hub = sim();
        // SandBot: 실제는 ping(LynxKeepAliveCommand) 뒤 패턴을 보낸다. 비용은 패턴 명령 하나만 센다. 끊긴 스레드면 둘 다 catch →
        // handleException(다시 끊음)이라 LED는 그대로다(currentSteps는 실제처럼 이미 바뀌었다)
        if (!hub.lynxCommand()) return; // LynxSetModuleLEDPatternCommand
        hub.publishLed(new ArrayList<Step>(steps));
        }

    //----------------------------------------------------------------------------------------------
    // Lynx 프로토콜(시뮬레이터에 없음)
    //----------------------------------------------------------------------------------------------

    @Override public boolean isParent()
        {
        return this.isParent;
        }

    public void pingAndQueryKnownInterfacesAndEtc() throws RobotCoreException, InterruptedException
        {
        }

    protected void initializeLEDS()
        {
        setPattern(blinkerPolicy.getIdlePattern(this));
        }

    protected void initializeDebugLogging() throws RobotCoreException, InterruptedException
        {
        }

    protected void pingInitialContact() throws RobotCoreException, InterruptedException
        {
        }

    public void validateCommand(LynxMessage lynxMessage) throws LynxUnsupportedCommandException
        {
        throw unsupported("validateCommand(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    public boolean isCommandSupported(Class<? extends LynxCommand> command)
        {
        return true;
        }

    protected boolean queryInterface(LynxInterface theInterface) throws InterruptedException
        {
        throw unsupported("queryInterface(com.qualcomm.hardware.lynx.commands.LynxInterface)");
        }

    @Override public LynxInterface getInterface(String interfaceName)
        {
        return this.interfacesQueried.get(interfaceName);
        }

    protected void ping()
        {
        }

    protected void ping(boolean initialPing) throws RobotCoreException, InterruptedException, LynxNackException
        {
        }

    protected int getMsModulePingInterval()
        {
        return 1950;
        }

    @Override public void resetPingTimer(LynxMessage message)
        {
        }

    protected void startPingTimer()
        {
        }

    protected void stopPingTimer(boolean wait)
        {
        }

    protected void startFtdiResetWatchdog()
        {
        }

    protected void stopFtdiResetWatchdog()
        {
        }

    protected void stopFtdiResetWatchdog(boolean disengaging)
        {
        }

    protected void setFtdiResetWatchdog(boolean enabled)
        {
        }

    protected void startExecutor()
        {
        }

    protected void stopExecutor()
        {
        }

    //----------------------------------------------------------------------------------------------
    // Bulk read caching
    //----------------------------------------------------------------------------------------------

    /** bulk read 한 번의 값(실제는 LynxGetBulkInputDataResponse를 감싼다) */
    public static class BulkData
        {
        private final SimHub.Snapshot resp;
        private final boolean fake;

        private BulkData(SimHub.Snapshot resp, boolean fake)
            {
            this.resp = resp;
            this.fake = fake;
            }

        public boolean getDigitalChannelState(int digitalInputZ)
            {
            return resp.digitalInputs[digitalInputZ];
            }

        public int getMotorCurrentPosition(int motorZ)
            {
            return resp.motorPositions[motorZ];
            }

        /** 부호 있는 모터 속도(엔코더 틱/초) */
        public int getMotorVelocity(int motorZ)
            {
            return resp.motorVelocities[motorZ];
            }

        public boolean isMotorBusy(int motorZ)
            {
            return resp.motorBusy[motorZ];
            }

        public boolean isMotorOverCurrent(int motorZ)
            {
            return resp.motorOverCurrent[motorZ];
            }

        /** 아날로그 입력(V) */
        public double getAnalogInputVoltage(int inputZ)
            {
            return getAnalogInputVoltage(inputZ, VoltageUnit.VOLTS);
            }

        public double getAnalogInputVoltage(int inputZ, VoltageUnit unit)
            {
            return unit.convert(resp.analogVolts[inputZ] * 1000.0, VoltageUnit.MILLIVOLTS);
            }

        public boolean isFake()
            {
            return fake;
            }
        }

    /**
     * 캐시를 비우고 모드와 관계없이 bulk read를 한다. 끊긴 스레드면 실제 catch 블록처럼 가짜 값(모두 0, isFake true)을
     * 돌려주고 캐시에 둔다({@link SimHub#getBulkData}).
     */
    public BulkData getBulkData()
        {
        synchronized (bulkCachingLock)
            {
            SimHub.Snapshot snapshot = sim().getBulkData();
            lastBulkData = new BulkData(snapshot, snapshot.fake);
            return lastBulkData;
            }
        }

    /**
     * BulkCachingMode: OFF는 읽기마다 명령, MANUAL은 clearBulkCache() 뒤 첫 읽기에서 bulk read, AUTO는 MANUAL과 같되
     * 같은 명령을 두 번 읽으면 캐시를 저절로 비운다.
     */
    public enum BulkCachingMode
        {
        OFF,
        MANUAL,
        AUTO
        }

    public BulkCachingMode getBulkCachingMode()
        {
        return sim().getBulkCachingMode();
        }

    /** OFF로 바꾸면 캐시를 비운다(MANUAL·AUTO 사이는 캐시를 지킨다) */
    public void setBulkCachingMode(BulkCachingMode mode)
        {
        synchronized (bulkCachingLock)
            {
            sim().setBulkCachingMode(mode);
            bulkCachingMode = mode;
            if (mode == BulkCachingMode.OFF) lastBulkData = null;
            }
        }

    public void clearBulkCache()
        {
        synchronized (bulkCachingLock)
            {
            sim().clearBulkCache();
            lastBulkData = null;
            }
        }

    //----------------------------------------------------------------------------------------------
    // Misc other commands
    //----------------------------------------------------------------------------------------------

    /**
     * LynxFailSafeCommand: 허브가 모터를 멈추고 서보 PWM을 끈다. 그 뒤 컨트롤러가 마지막 값을 잊는다. 끊긴 스레드면 실제
     * command.send()처럼 InterruptedException(끊김을 지움)이고 forgetLastKnown까지 가지 않는다.
     */
    public void failSafe() throws RobotCoreException, InterruptedException, LynxNackException
        {
        if (!sim().failSafe()) throw lockInterrupted(); // SandBot: 끊김
        forgetLastKnown();
        }

    @Override public void attemptFailSafeAndIgnoreErrors()
        {
        try { failSafe(); }
        catch (RuntimeException | RobotCoreException | InterruptedException | LynxNackException e) { /* Ignore */ }
        }

    public void enablePhoneCharging(boolean enable) throws RobotCoreException, InterruptedException, LynxNackException
        {
        if (!sim().lynxCommand()) throw lockInterrupted(); // LynxPhoneChargeControlCommand. SandBot: 끊김은 실제 send()처럼 던진다
        }

    public boolean isPhoneChargingEnabled() throws RobotCoreException, InterruptedException, LynxNackException
        {
        if (!sim().lynxCommand()) throw lockInterrupted(); // LynxPhoneChargeQueryCommand. SandBot: 끊김은 실제 sendReceive()처럼 던진다
        return isParent;
        }

    /** 허브 전체 전류(LynxGetADCCommand BATTERY_CURRENT). 입력 current(A, 기본 0). */
    public double getCurrent(CurrentUnit unit)
        {
        return readAdcMilli(unit, "current", 0);
        }

    /** 입력 gpioCurrent(A, 기본 0) */
    public double getGpioBusCurrent(CurrentUnit unit)
        {
        return readAdcMilli(unit, "gpioCurrent", 0);
        }

    /** 입력 i2cCurrent(A, 기본 0) */
    public double getI2cBusCurrent(CurrentUnit unit)
        {
        return readAdcMilli(unit, "i2cCurrent", 0);
        }

    /**
     * LynxGetADCCommand 하나. 끊긴 스레드면(SimHub의 비용 메서드가 false) 실제 catch → handleException(다시 끊음) 뒤의
     * LynxUsbUtil.makePlaceholderValue(0.0)이다: 단위를 바꾸지 않은 0.0이라 getTemperature(FARENHEIT)도 0.0이다.
     */
    private static final double ADC_PLACEHOLDER = 0.0;

    private double readAdcMilli(CurrentUnit unit, String key, double fallbackAmps)
        {
        SimHub hub = sim();
        if (!hub.lynxCommand()) return ADC_PLACEHOLDER;
        int milliamps = (int) Math.round(hub.input(key, fallbackAmps) * 1000);
        return unit.convert(milliamps, CurrentUnit.MILLIAMPS);
        }

    /** 배터리 전압(LynxGetADCCommand BATTERY_MONITOR). 입력 voltage(V). */
    public double getInputVoltage(VoltageUnit unit)
        {
        SimHub hub = sim();
        if (!hub.lynxCommand()) return ADC_PLACEHOLDER;
        int millivolts = (int) Math.round(hub.batteryVolts() * 1000);
        return unit.convert(millivolts, VoltageUnit.MILLIVOLTS);
        }

    /** 5 V 레일(LynxGetADCCommand FIVE_VOLT_MONITOR). 입력 auxVoltage(V, 기본 5.0). */
    public double getAuxiliaryVoltage(VoltageUnit unit)
        {
        SimHub hub = sim();
        if (!hub.lynxCommand()) return ADC_PLACEHOLDER;
        int millivolts = (int) Math.round(hub.input("auxVoltage", 5.0) * 1000);
        return unit.convert(millivolts, VoltageUnit.MILLIVOLTS);
        }

    /** 컨트롤러 온도(LynxGetADCCommand CONTROLLER_TEMPERATURE). 입력 temperature(°C, 기본 25). */
    public double getTemperature(TempUnit unit)
        {
        SimHub hub = sim();
        if (!hub.lynxCommand()) return ADC_PLACEHOLDER;
        int deciCelsius = (int) Math.round(hub.input("temperature", 25.0) * 10);
        return unit.fromCelsius(deciCelsius / 10.0);
        }

    /**
     * 구성에 있는 내장 IMU 종류. 실제처럼 먼저 getRevProductNumber(명령 하나)를 묻는다: 끊긴 스레드면 그것이 끊김을 지우고 로그를
     * 남긴다. 실제는 그다음 I2C 버스 0에서 BNO055·BHI260을 찾는다(SandBot: 그 I2C 트랜잭션은 세지 않고 구성의 종류를 쓴다).
     */
    public LynxModuleImuType getImuType()
        {
        getRevProductNumber(); // 실제 revHubTypeCanHaveImu(getRevProductNumber()): Expansion Hub·Control Hub는 늘 true
        return sim().imuType();
        }

    public void setDebug(DebugGroup group, DebugVerbosity verbosity) throws InterruptedException
        {
        // LynxSetDebugLogLevelCommand. SandBot: 끊김은 실제 send()처럼 던진다(실제 catch는 LynxNackException·RuntimeException만)
        if (!sim().lynxCommand()) throw lockInterrupted();
        }

    public enum DebugGroup
        {
        NONE(0),
            MAIN(1), TOHOST(2), FROMHOST(3), ADC(4), PWMSERVO(5), MODULELED(6),
            DIGITALIO(7), I2C(8), MOTOR0(9), MOTOR1(10), MOTOR2(11), MOTOR3(12);

        public final byte bVal;

        DebugGroup(int b)
            {
            this.bVal = (byte)b;
            }
        public static DebugGroup fromInt(int b)
            {
            for (DebugGroup debugGroup : DebugGroup.values())
                {
                if (debugGroup.bVal == (byte)b)
                    return debugGroup;
                }
            return NONE;
            }
        }

    public enum DebugVerbosity
        {
        OFF(0), LOW(1), MEDIUM(2), HIGH(3);

        public final byte bVal;

        DebugVerbosity(int b)
            {
            this.bVal = (byte)b;
            }
        public static DebugVerbosity fromInt(int b)
            {
            for (DebugVerbosity verbosity : DebugVerbosity.values())
                {
                if (verbosity.bVal == (byte)b)
                    return verbosity;
                }
            return OFF;
            }
        }

    //----------------------------------------------------------------------------------------------
    // Transmission(시뮬레이터에 없음)
    //----------------------------------------------------------------------------------------------

    @Override public <T> T acquireI2cLockWhile(Supplier<T> supplier) throws InterruptedException, RobotCoreException, LynxNackException
        {
        synchronized (this.i2cLock)
            {
            return supplier.get();
            }
        }

    @Override public void acquireNetworkTransmissionLock(LynxMessage message) throws InterruptedException
        {
        throw unsupported("acquireNetworkTransmissionLock(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    @Override public void releaseNetworkTransmissionLock(LynxMessage message) throws InterruptedException
        {
        throw unsupported("releaseNetworkTransmissionLock(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    @Override public void sendCommand(LynxMessage command) throws InterruptedException, LynxUnsupportedCommandException
        {
        throw unsupported("sendCommand(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    @Override public void retransmit(LynxMessage message) throws InterruptedException
        {
        throw unsupported("retransmit(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    @Override public void finishedWithMessage(LynxMessage message)
        {
        throw unsupported("finishedWithMessage(com.qualcomm.hardware.lynx.commands.LynxMessage)");
        }

    public void pretendFinishExtantCommands() throws InterruptedException
        {
        }

    public void onIncomingDatagramReceived(LynxDatagram datagram)
        {
        throw unsupported("onIncomingDatagramReceived(com.qualcomm.hardware.lynx.commands.LynxDatagram)");
        }

    public void abandonUnfinishedCommands()
        {
        }

    protected void nackUnfinishedCommands()
        {
        }

    //----------------------------------------------------------------------------------------------
    // Blinker policies
    //----------------------------------------------------------------------------------------------

    public interface BlinkerPolicy
        {
        List<Step> getIdlePattern(LynxModule lynxModule);
        List<Step> getVisuallyIdentifyPattern(LynxModule lynxModule);
        }

    public static class BreathingBlinkerPolicy implements BlinkerPolicy
        {
        // 청록색으로 숨쉬듯 밝아졌다 어두워진다
        @Override public List<Step> getIdlePattern(LynxModule lynxModule)
            {
            float[] hsv = new float[] { 0, 0, 0 };
            Color.colorToHSV(Color.CYAN, hsv);
            final float hue = hsv[0];
            final float saturation = 1;
            final int iStepLast = MAX_LED_STEPS/2;
            final int msIncrement = 2000 / (2 * iStepLast);
            final List<Step> steps = new ArrayList<>();
            for (int iStep = 0; iStep <= iStepLast; iStep++)
                {
                steps.add(breathingStep(hue, saturation, iStep, iStepLast, msIncrement));
                }
            for (int iStep = iStepLast-1; iStep > 0; iStep--)
                {
                steps.add(breathingStep(hue, saturation, iStep, iStepLast, msIncrement));
                }
            return steps;
            }

        private static Step breathingStep(float hue, float saturation, int iStep, int iStepLast, int msIncrement)
            {
            float min = 0.05f;
            float max = 1.0f;
            float value = (float)iStep / (float)iStepLast * (max-min) + min;
            value = 1-(float)Math.sqrt(1-value);
            int color = Color.HSVToColor(new float[] { hue, saturation, value });
            return new Step(color, msIncrement, TimeUnit.MILLISECONDS);
            }

        // 청록색과 자홍색 사이를 깜빡인다
        @Override public List<Step> getVisuallyIdentifyPattern(LynxModule lynxModule)
            {
            List<Step> steps = new ArrayList<>();
            int msIncrement = 150;
            steps.add(new Blinker.Step(Color.CYAN,    msIncrement,    TimeUnit.MILLISECONDS));
            steps.add(new Blinker.Step(Color.BLACK,  msIncrement /2, TimeUnit.MILLISECONDS));
            steps.add(new Blinker.Step(Color.MAGENTA, msIncrement,    TimeUnit.MILLISECONDS));
            steps.add(new Blinker.Step(Color.BLACK,  msIncrement /2, TimeUnit.MILLISECONDS));
            return steps;
            }
        }

    public static class CountModuleAddressBlinkerPolicy extends BreathingBlinkerPolicy
        {
        @Override public List<Step> getIdlePattern(LynxModule lynxModule)
            {
            List<Step> steps = new ArrayList<Step>();
            if (lynxModule.getModuleAddress() == 173)
                {
                // 내장 모듈은 숨은 주소라 초록색만 켠다
                steps.add(new Step(Color.GREEN, 1, TimeUnit.SECONDS));
                return steps;
                }
            int msLivenessLong = 5000;
            int msLivenessShort = 500;
            steps.add(new Step(Color.GREEN, msLivenessLong - msLivenessShort, TimeUnit.MILLISECONDS));
            steps.add(new Step(Color.BLACK, msLivenessShort, TimeUnit.MILLISECONDS));
            int slotsRemaining = MAX_LED_STEPS-steps.size();
            int blinkCount = Math.min(lynxModule.getModuleAddress(), slotsRemaining/2);
            for (int i = 0; i < blinkCount; i++)
                {
                steps.add(new Step(Color.BLUE, msLivenessShort, TimeUnit.MILLISECONDS));
                steps.add(new Step(Color.BLACK, msLivenessShort, TimeUnit.MILLISECONDS));
                }
            return steps;
            }
        }
    }
