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
// SandBot: FTC Dashboard 0.6.0의 ArrayProvider(core-0.6.0-sources.jar) 그대로. 배열을 든 필드는 로봇(ART)의 리플렉션 접근
// 규칙으로 읽는다(SandbotFieldAccess).
package com.acmerobotics.dashboard.config.reflection;

import com.acmerobotics.dashboard.config.ValueProvider;
import java.lang.reflect.Array;
import java.lang.reflect.Field;

public class ArrayProvider<T> implements ValueProvider<T> {
    private final Field field;
    private final Object parent;
    private final int[] indices;

    public ArrayProvider(Field field, Object parent, int... indices) {
        this.field = field;
        this.parent = parent;
        this.indices = indices;
    }

    @SuppressWarnings("unchecked")
    @Override
    public T get() {
        try {
            return (T) getArrayRecursive(SandbotFieldAccess.get(field, parent), indices);
        } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
        } catch (ArrayIndexOutOfBoundsException e) {
            return null;
        }
    }

    @Override
    public void set(T value) {
        try {
            setArrayRecursive(SandbotFieldAccess.get(field, parent), value, indices);
        } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
        } catch (ArrayIndexOutOfBoundsException ignored) {
        }
    }


    public static Object getArrayRecursive(Object object, int[] indices)
        throws ArrayIndexOutOfBoundsException, IllegalAccessException {
        for (int index : indices) {
            object = Array.get(object, index);
        }
        return object;
    }

    public static void setArrayRecursive(Object object, Object value, int[] indices) {
        for (int i = 0; i < indices.length - 1; i++) {
            object = Array.get(object, indices[i]);
        }
        Array.set(object, indices[indices.length - 1], value);
    }
}
