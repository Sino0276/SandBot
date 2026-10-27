/*
Copyright (c) 2017 Robert Atkinson

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
// SandBot: 실제 소스 그대로(gson @Expose와 ClassUtil 의존을 뺌, @string 자원 이름은 알려진 것만 글자로).
package com.qualcomm.robotcore.hardware.configuration;


import org.sandbot.sdk.devices.SandbotStrings;

import java.io.Serializable;

/**
 * {@link DistributorInfoState} contains metadata transcribed from {@link DistributorInfo}
 */
@SuppressWarnings("WeakerAccess")
public class DistributorInfoState implements Serializable, Cloneable
    {
    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    private String distributor;
    private String model;
    private String url;

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    public DistributorInfoState()
        {
        distributor = "";
        model = "";
        url = "";
        }

    public static DistributorInfoState from(DistributorInfo info)
        {
        DistributorInfoState result = new DistributorInfoState();
        result.setDistributor(SandbotStrings.decodeStringRes(info.distributor()));
        result.setModel(SandbotStrings.decodeStringRes(info.model()));
        result.setUrl(SandbotStrings.decodeStringRes(info.url()));
        return result;
        }

    public DistributorInfoState clone()
        {
        try {
            return (DistributorInfoState)super.clone();
            }
        catch (CloneNotSupportedException e)
            {
            throw new RuntimeException("internal error: Parameters not cloneable");
            }
        }

    //----------------------------------------------------------------------------------------------
    // Accessing
    //----------------------------------------------------------------------------------------------

    public String getDistributor()
        {
        return distributor;
        }

    public void setDistributor(String distributor)
        {
        this.distributor = distributor.trim();
        }

    public String getModel()
        {
        return model;
        }

    public void setModel(String model)
        {
        this.model = model.trim();
        }

    public String getUrl()
        {
        return url;
        }

    public void setUrl(String url)
        {
        this.url = url.trim();
        }
    }
