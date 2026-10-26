package org.sandbot.sim;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 이번 실행의 장치 목록(구성 이름마다 하나, 넣은 순서). */
public final class SimDevices {
    private final Map<String, SimDevice> byName = new LinkedHashMap<>();

    /** 같은 이름이 이미 있으면 IllegalStateException(같은 포트의 모터·데드휠처럼 이름을 함께 쓰면 장치 하나를 함께 쓴다) */
    public synchronized SimDevice add(String name, String kind) {
        if (byName.containsKey(name)) throw new IllegalStateException("duplicate simulated device: " + name);
        SimDevice device = new SimDevice(name, kind);
        byName.put(name, device);
        return device;
    }

    public synchronized SimDevice get(String name) {
        return byName.get(name);
    }

    public synchronized List<SimDevice> all() {
        return Collections.unmodifiableList(new ArrayList<>(byName.values()));
    }
}
