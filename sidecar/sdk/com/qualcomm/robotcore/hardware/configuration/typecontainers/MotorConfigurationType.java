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
// SandBot: 실제 소스에서 출발. 형식 목록(ConfigurationTypeManager가 애너테이션에서 만드는 것)은 SDK 소스의 모터 애너테이션 값을 그대로 옮긴 표로 둔다.
package com.qualcomm.robotcore.hardware.configuration.typecontainers;


import com.qualcomm.robotcore.hardware.configuration.annotations.ExpansionHubPIDFPositionParams;
import com.qualcomm.robotcore.hardware.configuration.annotations.ExpansionHubPIDFVelocityParams;
import com.qualcomm.robotcore.hardware.configuration.ConfigurationTypeManager.ClassSource;
import com.qualcomm.robotcore.hardware.configuration.DistributorInfo;
import com.qualcomm.robotcore.hardware.configuration.DistributorInfoState;
import com.qualcomm.robotcore.hardware.configuration.ExpansionHubMotorControllerParamsState;
import com.qualcomm.robotcore.hardware.configuration.ExpansionHubMotorControllerPositionParams;
import com.qualcomm.robotcore.hardware.configuration.ExpansionHubMotorControllerVelocityParams;
import com.qualcomm.robotcore.hardware.configuration.MotorType;

import org.firstinspires.ftc.robotcore.external.navigation.Rotation;
import org.sandbot.sdk.devices.SandbotStrings;

import java.util.HashMap;
import java.util.Map;

/**
 * {@link MotorConfigurationType} contains the amalgamated set of information that
 * is known about a given type of motor.
 */
@SuppressWarnings("WeakerAccess")
public final class MotorConfigurationType extends UserConfigurationType implements Cloneable
    {
    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    // Maybe someday we'll expose ticksPerRev, maxRPM, and distributorInfo via the config UI, but
    // the other information does not seem very useful to the user.
    private double ticksPerRev;
    private double maxRPM;
    private DistributorInfoState distributorInfo = new DistributorInfoState();

    private double gearing;
    private double achieveableMaxRPMFraction;
    private Rotation orientation;
    private ExpansionHubMotorControllerParamsState hubVelocityParams = new ExpansionHubMotorControllerParamsState();
    private ExpansionHubMotorControllerParamsState hubPositionParams = new ExpansionHubMotorControllerParamsState();

    //----------------------------------------------------------------------------------------------
    // Accessing
    //----------------------------------------------------------------------------------------------

    public double getTicksPerRev()
        {
        return ticksPerRev;
        }

    public double getAchieveableMaxTicksPerSecond()
        {
        final double encoderTicksPerRev = this.getTicksPerRev();
        final double maxRPM             = this.getMaxRPM() * this.getAchieveableMaxRPMFraction();
        final double secondsPerMinute   = 60;
        return encoderTicksPerRev * maxRPM / secondsPerMinute;
        }
    public int getAchieveableMaxTicksPerSecondRounded()
        {
        return (int)Math.round(getAchieveableMaxTicksPerSecond());
        }

    public void setTicksPerRev(double ticksPerRev)
        {
        this.ticksPerRev = ticksPerRev;
        }

    public double getGearing()
        {
        return gearing;
        }

    public void setGearing(double gearing)
        {
        this.gearing = gearing;
        }

    public double getMaxRPM()
        {
        return maxRPM;
        }

    public void setMaxRPM(double maxRPM)
        {
        this.maxRPM = maxRPM;
        }

    public double getAchieveableMaxRPMFraction()
        {
        return achieveableMaxRPMFraction;
        }

    public void setAchieveableMaxRPMFraction(double achieveableMaxRPMFraction)
        {
        this.achieveableMaxRPMFraction = achieveableMaxRPMFraction;
        }

    public Rotation getOrientation()
        {
        return orientation;
        }

    public void setOrientation(Rotation orientation)
        {
        this.orientation = orientation;
        }

    public boolean hasExpansionHubVelocityParams()
        {
        return !hubVelocityParams.isDefault();
        }

    public ExpansionHubMotorControllerParamsState getHubVelocityParams()
        {
        return hubVelocityParams;
        }

    public boolean hasExpansionHubPositionParams()
        {
        return !hubPositionParams.isDefault();
        }

    public ExpansionHubMotorControllerParamsState getHubPositionParams()
        {
        return hubPositionParams;
        }

    public DistributorInfoState getDistributorInfo()
        {
        return distributorInfo;
        }

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    /** 구성의 Motor 태그(UnspecifiedMotor) 형식 */
    public static MotorConfigurationType getUnspecifiedMotorType()
        {
        return BY_CLASS.get(UNSPECIFIED_MOTOR_CLASS);
        }

    /** 모터 형식 인터페이스(com.qualcomm.hardware.motors.GoBILDA5202Series 등)의 형식. 모터 형식이 아니면 null. */
    public static MotorConfigurationType getMotorType(Class<?> clazz)
        {
        return clazz == null ? null : BY_CLASS.get(clazz.getName());
        }

    //----------------------------------------------------------------------------------------------
    // 내장 모터 형식(실제는 ConfigurationTypeManager가 애너테이션에서 만든다. 값은 SDK 12.0 소스의
    // @MotorType·@DeviceProperties·@DistributorInfo·@ExpansionHubMotorController*Params 그대로)
    //----------------------------------------------------------------------------------------------

    private static final String UNSPECIFIED_MOTOR_CLASS = "com.qualcomm.robotcore.hardware.configuration.UnspecifiedMotor";
    private static final Map<String, MotorConfigurationType> BY_CLASS = new HashMap<String, MotorConfigurationType>();

    static
        {
        builtIn("com.qualcomm.hardware.motors.GoBILDA5201Series", "goBILDA5201SeriesMotor", "GoBILDA 5201 series", 1500, 54, 104, Rotation.CCW, "goBILDA_distributor", "goBILDA-5201", "https://www.gobilda.com/5201-series-spur-gear-motors/");
        builtIn("com.qualcomm.hardware.motors.GoBILDA5202Series", "goBILDA5202SeriesMotor", "GoBILDA 5202/3/4 series", 2786, 99.5, 60, Rotation.CCW, "goBILDA_distributor", "goBILDA-5202", "https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motors/");
        builtIn("com.qualcomm.hardware.motors.Matrix12vMotor", "Matrix12vMotor", "Matrix 12v Motor", 1478.4, 52.8, 190, Rotation.CW, "Modern Robotics", "50-0120", "http://www.modernroboticsinc.com/12v-6mm-motor-kit-2");
        builtIn("com.qualcomm.hardware.motors.NeveRest20Gearmotor", "NeveRest20Gearmotor", "NeveRest 20 Gearmotor", 560, 20, 315, Rotation.CW, "AndyMark", "am-3102", "http://www.andymark.com/NeveRest-20-12V-Gearmotor-p/am-3102.htm");
        builtIn("com.qualcomm.hardware.motors.NeveRest3_7GearmotorV1", "NeveRest3.7v1Gearmotor", "NeveRest 3.7 v1 Gearmotor", 44.4, 3.7, 1784, Rotation.CCW, "AndyMark", "am-3461", "");
        builtIn("com.qualcomm.hardware.motors.NeveRest40Gearmotor", "NeveRest40Gearmotor", "NeveRest 40 Gearmotor", 1120, 40, 160, Rotation.CCW, "AndyMark", "am-2964a", "http://www.andymark.com/NeveRest-40-Gearmotor-p/am-2964a.htm");
        builtIn("com.qualcomm.hardware.motors.NeveRest60Gearmotor", "NeveRest60Gearmotor", "NeveRest 60 Gearmotor", 1680, 60, 105, Rotation.CCW, "AndyMark", "am-3103", "http://www.andymark.com/NeveRest-60-Gearmotor-p/am-3103.htm");
        builtIn("com.qualcomm.hardware.motors.RevRobotics20HdHexMotor", "RevRobotics20HDHexMotor", "@string/rev_20_hd_hex_name", 560, 20, 300, Rotation.CCW, "@string/rev_distributor", "REV-41-1301", "http://www.revrobotics.com/rev-41-1301");
        builtIn("com.qualcomm.hardware.motors.RevRobotics40HdHexMotor", "RevRobotics40HDHexMotor", "@string/rev_40_hd_hex_name", 1120, 40, 150, Rotation.CCW, "@string/rev_distributor", "REV-41-1301", "http://www.revrobotics.com/rev-41-1301");
        MotorConfigurationType coreHex = builtIn("com.qualcomm.hardware.motors.RevRoboticsCoreHexMotor", "RevRoboticsCoreHexMotor", "@string/rev_core_hex_name", 288, 36.25, 137, Rotation.CCW, "@string/rev_distributor", "REV-41-1300", "http://www.revrobotics.com/rev-41-1300");
        coreHex.hubVelocityParams = new ExpansionHubMotorControllerParamsState(com.qualcomm.robotcore.hardware.DcMotor.RunMode.RUN_USING_ENCODER,
                new com.qualcomm.robotcore.hardware.PIDFCoefficients(10, 3, 0, 0, com.qualcomm.robotcore.hardware.MotorControlAlgorithm.LegacyPID));
        coreHex.hubPositionParams = new ExpansionHubMotorControllerParamsState(com.qualcomm.robotcore.hardware.DcMotor.RunMode.RUN_TO_POSITION,
                new com.qualcomm.robotcore.hardware.PIDFCoefficients(10, 0.05, 0, 0, com.qualcomm.robotcore.hardware.MotorControlAlgorithm.LegacyPID));
        builtIn("com.qualcomm.hardware.motors.RevRoboticsUltraPlanetaryHdHexMotor", "RevRoboticsUltraplanetaryHDHexMotor", "@string/rev_ultraplanetary_hd_hex_name", 560, 20, 300, Rotation.CW, "@string/rev_distributor", "REV-41-1600", "https://www.revrobotics.com/rev-41-1600/");
        builtIn("com.qualcomm.hardware.motors.StudicaMaverickMotor", "StudicaMaverick", "Studica Maverick", 1464, 61, 100, Rotation.CW, "Studica", "75001", "https://www.studica.co/maverick-12v-dc-gear-motor-wencoder");
        builtIn("com.qualcomm.hardware.motors.TetrixMotor", "TetrixMotor", "Tetrix Motor", 1440, 52, 165, Rotation.CW, "Pitsco", "W39530", "http://www.pitsco.com/TETRIX_DC_Gear_Motor");
        builtIn(UNSPECIFIED_MOTOR_CLASS, "Motor", "Unspecified Motor", 1440, 52, 165, Rotation.CW, null, null, null);
        }

    private static MotorConfigurationType builtIn(String className, String xmlTag, String name, double ticksPerRev, double gearing,
            double maxRPM, Rotation orientation, String distributor, String model, String url)
        {
        MotorConfigurationType type = new MotorConfigurationType(xmlTag);
        type.name = SandbotStrings.decodeStringRes(name);
        type.ticksPerRev = ticksPerRev;
        type.gearing = gearing;
        type.maxRPM = maxRPM;
        type.achieveableMaxRPMFraction = 0.85; // @MotorType 기본값
        type.orientation = orientation;
        if (distributor != null)
            {
            type.distributorInfo.setDistributor(SandbotStrings.decodeStringRes(distributor));
            type.distributorInfo.setModel(model);
            type.distributorInfo.setUrl(url);
            }
        BY_CLASS.put(className, type);
        return type;
        }

    private MotorConfigurationType(String xmlTag)
        {
        super(DeviceFlavor.MOTOR, xmlTag, true);
        }

    public MotorConfigurationType(Class clazz, String xmlTag, ClassSource classSource)
        {
        super(clazz, DeviceFlavor.MOTOR, xmlTag, classSource);
        }

    // Used by gson deserialization
    public MotorConfigurationType()
        {
        super(DeviceFlavor.MOTOR);
        }

    public MotorConfigurationType clone()
        {
        try {
            MotorConfigurationType result = (MotorConfigurationType)super.clone();
            result.distributorInfo = distributorInfo.clone();
            result.hubVelocityParams = hubVelocityParams.clone();
            result.hubPositionParams = hubPositionParams.clone();
            return result;
            }
        catch (CloneNotSupportedException e)
            {
            throw new RuntimeException("internal error: Parameters not cloneable");
            }
        }

    public boolean processAnnotation(Object params)
        {
        if (params != null)
            {
            if (params instanceof ExpansionHubPIDFVelocityParams)            return processAnnotation((ExpansionHubPIDFVelocityParams)params);
            if (params instanceof ExpansionHubMotorControllerVelocityParams) return processAnnotation((ExpansionHubMotorControllerVelocityParams)params);
            if (params instanceof ExpansionHubPIDFPositionParams)            return processAnnotation((ExpansionHubPIDFPositionParams)params);
            if (params instanceof ExpansionHubMotorControllerPositionParams) return processAnnotation((ExpansionHubMotorControllerPositionParams)params);
            if (params instanceof DistributorInfo)                           return processAnnotation((DistributorInfo)params);
            }
        return false;
        }

    public boolean processAnnotation(MotorType motorType)
        {
        if (motorType != null)
            {
            if (name.isEmpty())
                {
                name = SandbotStrings.decodeStringRes(motorType.name().trim());
                }

            ticksPerRev = motorType.ticksPerRev();
            gearing = motorType.gearing();
            maxRPM = motorType.maxRPM();
            achieveableMaxRPMFraction = motorType.achieveableMaxRPMFraction();
            orientation = motorType.orientation();
            return true;
            }
        return false;
        }

    public boolean processAnnotation(com.qualcomm.robotcore.hardware.configuration.annotations.MotorType motorType)
        {
        if (motorType != null)
            {
            ticksPerRev = motorType.ticksPerRev();
            gearing = motorType.gearing();
            maxRPM = motorType.maxRPM();
            achieveableMaxRPMFraction = motorType.achieveableMaxRPMFraction();
            orientation = motorType.orientation();
            return true;
            }
        return false;
        }

    public boolean processAnnotation(ExpansionHubPIDFVelocityParams params)
        {
        if (params != null)
            {
            hubVelocityParams = new ExpansionHubMotorControllerParamsState(params);
            return true;
            }
        return false;
        }

    public boolean processAnnotation(ExpansionHubMotorControllerVelocityParams params)
        {
        if (params != null)
            {
            hubVelocityParams = new ExpansionHubMotorControllerParamsState(params);
            return true;
            }
        return false;
        }

    public boolean processAnnotation(ExpansionHubPIDFPositionParams params)
        {
        if (params != null)
            {
            hubPositionParams = new ExpansionHubMotorControllerParamsState(params);
            return true;
            }
        return false;
        }

    public boolean processAnnotation(ExpansionHubMotorControllerPositionParams params)
        {
        if (params != null)
            {
            hubPositionParams = new ExpansionHubMotorControllerParamsState(params);
            return true;
            }
        return false;
        }

    public boolean processAnnotation(DistributorInfo info)
        {
        if (info != null)
            {
            if (name.isEmpty())
                {
                String distributor = SandbotStrings.decodeStringRes(info.distributor().trim());
                String model = SandbotStrings.decodeStringRes(info.model().trim());
                if (!distributor.isEmpty() && !model.isEmpty())
                    {
                    name = distributor + " " + model;
                    }
                }

            distributorInfo = DistributorInfoState.from(info);
            return true;
            }
        return false;
        }

    public void finishedAnnotations(Class clazz)
        {
        if (name.isEmpty())
            {
            name = clazz.getSimpleName();
            }
        }

    //----------------------------------------------------------------------------------------------
    // Serialization (used in local marshalling during configuration editing)
    //----------------------------------------------------------------------------------------------

    private Object writeReplace()
        {
        return new SerializationProxy(this);
        }
    }
