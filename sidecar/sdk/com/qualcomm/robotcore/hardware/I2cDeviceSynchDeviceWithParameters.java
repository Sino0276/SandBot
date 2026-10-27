// SandBot: 실제 소스에서 I2cWarningManager(DS 경고 표시)만 뺌(I2cWarningManager 때문에 들여오지 못해서 손 구현으로 둔다).
package com.qualcomm.robotcore.hardware;

import com.qualcomm.robotcore.util.RobotLog;


/**
 * {@link I2cDeviceSynchDeviceWithParameters} adds to {@link I2cDeviceSynchDevice} support for
 * sensors that can be publicly initialized with a particular parameters class.
 */
public abstract class I2cDeviceSynchDeviceWithParameters<DEVICE_CLIENT extends I2cDeviceSynchSimple, PARAMETERS>
        extends I2cDeviceSynchDevice<DEVICE_CLIENT>
    {
    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    protected volatile PARAMETERS parameters;
    protected final PARAMETERS defaultParameters;

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    protected I2cDeviceSynchDeviceWithParameters(DEVICE_CLIENT deviceClient, boolean deviceClientIsOwned, PARAMETERS defaultParameters)
        {
        super(deviceClient, deviceClientIsOwned);
        this.parameters = defaultParameters;
        this.defaultParameters = defaultParameters;
        }

    //----------------------------------------------------------------------------------------------
    // Parameters
    //----------------------------------------------------------------------------------------------

    /**
     * Returns the parameter block currently in use for this sensor
     * @return the parameter block currently in use for this sensor
     */
    public PARAMETERS getParameters()
        {
        return this.parameters;
        }

    @Override protected synchronized boolean doInitialize()
        {
        return internalInitialize(this.parameters);
        }

    @Override
    public void resetDeviceConfigurationForOpMode()
        {
        super.resetDeviceConfigurationForOpMode();
        this.parameters = defaultParameters;
        }

    /**
     * Allows for external initialization with non-default parameters
     * @param parameters the parameters with which the sensor should be initialized
     * @return whether the initialization was successful or not.
     */
    public boolean initialize(PARAMETERS parameters)
        {
        this.isInitialized = internalInitialize(parameters);
        if (!this.isInitialized)
            {
            RobotLog.e("Marking I2C device %s %s as unhealthy because initialization failed", getClass().getSimpleName(), getConnectionInfo());
            }
        return this.isInitialized;
        }

    /**
     * Actually attempts to carry out initialization with the indicated parameter block.
     * If successful, said parameter block should be stored in the {@link #parameters}
     * member variable.
     * @param parameters    the parameter block with which to initialize
     * @return              whether initialization was successful or not
     */
    protected abstract boolean internalInitialize(PARAMETERS parameters);
    }
