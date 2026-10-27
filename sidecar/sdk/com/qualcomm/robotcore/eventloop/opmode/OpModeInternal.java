/* Copyright (c) 2014-2022 Qualcomm Technologies Inc, REV Robotics

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
// SandBot: executor로 OpMode 스레드를 띄우는 대신 사이드카 런타임이 OpMode 스레드에서 internalRunOpModeOnThisThread를 부르고(SandbotOpModeBridge), internalStop은 기다리지 않는다(정지 대기 감시는 런타임이 가상 시간으로 한다).

package com.qualcomm.robotcore.eventloop.opmode;

import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;
import org.firstinspires.ftc.robotcore.internal.opmode.TelemetryImpl;
import org.firstinspires.ftc.robotcore.internal.opmode.TelemetryInternal;

import java.util.concurrent.CancellationException;

/**
 * This class is package-private, and has many package-private members. Do NOT mark them as
 * protected, since we do not want to make them available to the user's subclasses (we don't want to
 * make the API surface huge), only the OpMode and LinearOpMode subclasses.
 */
abstract class OpModeInternal {
    /**
     * The approximate duration in milliseconds that the OpMode is allowed to run after a stop has
     * been requested before it is considered stuck and is forcefully stopped.
     */
    public static final int MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED = 900;

    //----------------------------------------------------------------------------------------------
    // Public fields for use by end users
    //----------------------------------------------------------------------------------------------

    /**
     * Gamepad 1
     */
    public volatile Gamepad gamepad1 = null;

    /**
     * Gamepad 2
     */
    public volatile Gamepad gamepad2 = null;

    /**
     * Allows text and numerical data to be transmitted for display on the Driver Station. This data
     * is automatically transmitted on a regular, periodic basis.
     */
    public Telemetry telemetry = new TelemetryImpl((OpMode) this);

    /**
     * Mapping of configured device names to Java objects that can be used to access them
     */
    public volatile HardwareMap hardwareMap = null; // will be set in OpModeManager.runActiveOpMode

    /**
     * @deprecated This value is no longer respected. You can access a read-only version of this
     * value at {@link #MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED}
     */
    @Deprecated public int msStuckDetectStop = MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED;

    //----------------------------------------------------------------------------------------------
    // Package-private variable members
    //----------------------------------------------------------------------------------------------

    // SandBot: executorService 대신 OpMode 스레드(LinearOpMode가 STOP 때 끼어든다)
    volatile Thread opModeThread = null;
    volatile OpModeServices internalOpModeServices = null;
    volatile boolean isStarted = false;
    volatile boolean stopRequested = false;
    volatile boolean opModeThreadFinished = false;
    volatile RuntimeException exception = null;
    volatile NoClassDefFoundError noClassDefFoundError = null;

    // These are only accessed from the main event loop, and do not need to be volatile
    Gamepad previousGamepad1Data = new Gamepad();
    Gamepad previousGamepad2Data = new Gamepad();

    //----------------------------------------------------------------------------------------------
    // Public methods for use by end users
    //----------------------------------------------------------------------------------------------

    /**
     * Requests that this OpMode be shut down if it is the currently active OpMode, much as if the stop
     * button had been pressed on the driver station.
     * <p>
     * If this is not the currently active OpMode, then this function has no effect. Note that as part of
     * this processing, the OpMode's {@code stop()} method will be called, as that is part of the usual
     * shutdown logic.
     * <p>
     * Note that this may be called from <em>any</em> thread.
     */
    public final void requestOpModeStop() {
        this.internalOpModeServices.requestOpModeStop((OpMode) this);
    }

    //----------------------------------------------------------------------------------------------
    // Package-private hooks for OpMode and LinearOpMode
    //
    // Because LinearOpMode extends OpMode for historical reasons, it's important that LinearOpMode
    // overrides ALL of these hooks.
    //----------------------------------------------------------------------------------------------

    /** Called on the OpModeThread when the OpMode is initialized */
    abstract void internalRunOpMode() throws InterruptedException;

    /** Called on the main event loop thread when the OpMode is started. */
    void internalOnStart() { }

    /** Called on the main event loop thread periodically. */
    void internalOnEventLoopIteration() { }

    /**
     * Called on the main event loop thread when the OpMode is requested to stop.
     * <p>
     * It is OK for implementations to take over the stop process, as long as they exit as soon as
     * user code is done executing. If an implementation wants its thread interrupted, it needs to
     * call {@code executorService.shutdownNow()} from this method.
     */
    void internalOnStopRequested() { }

    /**
     * Called on the main event loop thread when new gamepad data is available.
     * <p>
     * Implementations MUST copy the data from these instances into the gamepad1 and gamepad2
     * objects that are exposed to the user. They must NOT replace the gamepad1 and gamepad2
     * instances, as that would wipe out any queued effects.
     */
    abstract void newGamepadDataAvailable(Gamepad latestGamepad1Data, Gamepad latestGamepad2Data);

    //----------------------------------------------------------------------------------------------
    // Package-private methods for use by OpModeManagerImpl
    //----------------------------------------------------------------------------------------------

    // SandBot: 실제 internalInit의 앞부분(상태 초기화). OpMode 스레드를 띄우지 않는다.
    final void internalInit() {
        exception = null;
        noClassDefFoundError = null;
        isStarted = false;
        stopRequested = false;
        opModeThreadFinished = false;

        // Reset telemetry in case OpMode instance gets reused from run to run
        if (telemetry instanceof TelemetryInternal) {
            ((TelemetryInternal)telemetry).resetTelemetryForOpMode();
        }

        gamepad1.resetEdgeDetection();
        gamepad2.resetEdgeDetection();
        gamepad1.setTriggerThreshold(Gamepad.DEFAULT_TRIGGER_THRESHOLD);
        gamepad2.setTriggerThreshold(Gamepad.DEFAULT_TRIGGER_THRESHOLD);
    }

    // SandBot: 실제 internalInit이 executor에 넘기던 OpMode 스레드 본문. 런타임이 OpMode 스레드에서 부른다.
    // RuntimeException·NoClassDefFoundError는 실제처럼 필드에 남기고, 그 밖의 Error(SimExit 등)는 finally 뒤에 그대로 나간다.
    final void internalRunOpModeOnThisThread() {
        opModeThread = Thread.currentThread();
        try {
            internalRunOpMode();
        } catch (InterruptedException ie) {
            // InterruptedException, shutting down the OpMode
            RobotLog.d("OpMode received an InterruptedException; shutting down");
            requestOpModeStop();
        } catch (CancellationException ie) {
            // In our system, CancellationExceptions are thrown when data was trying to be acquired, but
            // an interrupt occurred, and you're in the unfortunate situation that the data acquisition API
            // involved doesn't allow InterruptedExceptions to be thrown. You can't return (what data would
            // you return?), and so you have to throw a RuntimeException. CancellationException seems the
            // best choice.
            RobotLog.d("OpMode received a CancellationException; shutting down");
            requestOpModeStop();
        } catch (RuntimeException e) {
            exception = e;
            // We do NOT call requestOpModeStop() in this case, because we want to make sure the
            // exception gets a chance to be thrown on the event loop thread.
        } catch (NoClassDefFoundError e) {
            noClassDefFoundError = e;
        } finally {
            // If the user has given us a telemetry.update() that hasn't yet gone out, then
            // push it out now.
            // SandBot: I2cWarningManager.suppressNewProblemDeviceWarningsWhile 없이(장치 건강 경고가 없다)
            if (telemetry instanceof TelemetryInternal) {
                telemetry.setMsTransmissionInterval(0); // will be reset the next time the OpMode runs
                ((TelemetryInternal) telemetry).tryUpdateIfDirty();
            }
            opModeThreadFinished = true;
        }
    }

    // Package-private
    final void internalStart() {
        gamepad1.resetEdgeDetection();
        gamepad2.resetEdgeDetection();

        stopRequested = false;
        isStarted = true;
        // It's important that the states are updated BEFORE LinearOpModes notify the runningNotifier
        internalOnStart();
    }

    // Package-private
    final void internalThrowOpModeExceptionIfPresent() {
        // if there is a runtime exception in user code; throw it so the normal error
        // reporting process can handle it
        if (exception != null) {
            throw exception;
        }
        // if there is a NoClassDefFoundError; throw it so the normal error reporting process can
        // handle it. It could be due to an external library that is missing.
        if (noClassDefFoundError != null) {
            throw noClassDefFoundError;
        }
    }

    // Package-private
    // SandBot: OpMode 스레드가 끝나기를 기다리지 않는다. 런타임이 틱 경계(OpMode 스레드 안)에서 부르고,
    // MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED(가상 시간) 안에 끝나지 않으면 stuckInStop으로 끝낸다.
    final void internalStop() {
        /*
         * Get out of dodge. Been here, done this.
         */
        if(stopRequested)  { return; }

        stopRequested = true;

        // Implementations of this method may run for a while, if the OpMode implementation
        // wants to handle shutdown in a special way. In particular, the OpMode implementation
        // gets to decide if it wants its thread interrupted or not, and if so, when.
        internalOnStopRequested();
    }
}
