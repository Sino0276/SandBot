/*
Copyright (c) 2024 Limelight Vision

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted (subject to the limitations in the disclaimer below) provided that
the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of Limelight Vision nor the names of its contributors may be used to
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
// SandBot: 실제 API는 그대로. 카메라의 HTTP 서버가 없으므로 요청을 보내는 메서드는 응답이 없는 카메라처럼 false를 돌려주고,
// 결과·상태·보정 값은 실제처럼 응답이 없을 때의 기본값이다(빈 JSON으로 만든 무효 LLResult, 기본 LLStatus·CalibrationResult).
package com.qualcomm.hardware.limelightvision;

import com.qualcomm.hardware.limelightvision.LLResultTypes.CalibrationResult;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.util.SerialNumber;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;

import java.net.InetAddress;

/**
 * Limelight 3A 카메라. 시뮬레이터에는 영상 인식이 없어서 1단계는 연결되지 않은 카메라처럼 보인다(isConnected false).
 * 출력: running, pollRateHz, pipeline(마지막으로 고른 번호), robotYaw(마지막 updateRobotOrientation 값, 도).
 */
public class Limelight3A implements HardwareDevice
{
    private static final int MIN_POLL_RATE_HZ = 1;
    private static final int MAX_POLL_RATE_HZ = 250;
    private static final long ISCONNECTED_THRESHOLD = 250;
    private static final int PYTHON_INPUT_MAX_SIZE = 32;

    private final String name;
    private final InetAddress inetAddress;
    private boolean running = false;
    private long pollIntervalMs = 10;
    private final long lastUpdateTime = 0;
    private SimDevice device;

    public Limelight3A(SerialNumber serialNumber, String name, InetAddress ipAddress)
    {
        this.name = name;
        this.inetAddress = ipAddress;
        this.device = Sim.devices().get(name);
        publish();
    }

    private void publish()
    {
        if (device == null) return;
        device.output("running", running);
        device.output("pollRateHz", (int) (1000 / pollIntervalMs));
    }

    public synchronized void start()
    {
        running = true;
        publish();
    }

    public synchronized void pause()
    {
        running = false;
        publish();
    }

    public synchronized void stop()
    {
        running = false;
        publish();
    }

    public boolean isRunning()
    {
        return running;
    }

    /** 실행 중이면 바꾸지 않는다(실제와 같음) */
    public synchronized void setPollRateHz(int rateHz)
    {
        if (running) return;
        int clampedRate = Math.max(MIN_POLL_RATE_HZ, Math.min(rateHz, MAX_POLL_RATE_HZ));
        this.pollIntervalMs = 1000 / clampedRate;
        publish();
    }

    /** 마지막 결과를 받은 뒤 지난 시간(ms). 결과를 받은 적이 없으므로 시작 시각(0)부터다. */
    public long getTimeSinceLastUpdate()
    {
        long now = Sim.installed() ? Sim.clock().currentTimeMillis() : 0;
        return now - lastUpdateTime;
    }

    public boolean isConnected()
    {
        return getTimeSinceLastUpdate() <= ISCONNECTED_THRESHOLD;
    }

    private LLResult latestResult;

    public LLResult getLatestResult()
    {
        if (latestResult == null) latestResult = LLResult.parse(new org.json.JSONObject());
        return latestResult;
    }

    public LLStatus getStatus()
    {
        return new LLStatus();
    }

    public boolean reloadPipeline()
    {
        return false;
    }

    public boolean pipelineSwitch(int index)
    {
        if (device != null) device.output("pipeline", index);
        return false;
    }

    public boolean captureSnapshot(String snapname)
    {
        return false;
    }

    public boolean deleteSnapshots()
    {
        return false;
    }

    public boolean deleteSnapshot(String snapname)
    {
        return false;
    }

    public boolean updatePythonInputs(double input1, double input2, double input3, double input4,
                                      double input5, double input6, double input7, double input8)
    {
        return updatePythonInputs(new double[]{input1, input2, input3, input4, input5, input6, input7, input8});
    }

    public boolean updatePythonInputs(double[] inputs)
    {
        if (inputs == null || inputs.length == 0 || inputs.length > PYTHON_INPUT_MAX_SIZE) return false;
        return false;
    }

    public boolean updateRobotOrientation(double yaw)
    {
        if (device != null) device.output("robotYaw", yaw);
        return false;
    }

    public boolean uploadPipeline(String jsonString, Integer index)
    {
        return false;
    }

    public boolean uploadFieldmap(LLFieldMap fieldmap, Integer index)
    {
        return false;
    }

    public boolean uploadPython(String pythonString, Integer index)
    {
        return false;
    }

    public CalibrationResult getCalDefault()
    {
        return new CalibrationResult();
    }

    public CalibrationResult getCalFile()
    {
        return new CalibrationResult();
    }

    public CalibrationResult getCalEEPROM()
    {
        return new CalibrationResult();
    }

    public CalibrationResult getCalLatest()
    {
        return new CalibrationResult();
    }

    public void shutdown()
    {
        stop();
    }

    @Override
    public Manufacturer getManufacturer()
    {
        return Manufacturer.LimelightVision;
    }

    @Override
    public String getDeviceName()
    {
        return name;
    }

    @Override
    public String getConnectionInfo()
    {
        return "EthernetOverUsb (" + inetAddress.getHostAddress() + ")";
    }

    @Override
    public int getVersion()
    {
        return 0;
    }

    @Override
    public void resetDeviceConfigurationForOpMode()
    {
    }

    @Override
    public void close()
    {
        stop();
    }
}
