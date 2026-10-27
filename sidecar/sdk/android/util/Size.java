/*
 * Copyright (C) 2014 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// SandBot: 안드로이드 android.util.Size(API 21)와 같은 동작을 순수 Java로(VisionPortal.Builder.setCameraResolution 등).
package android.util;

/** 너비·높이(픽셀) 한 쌍. 바꿀 수 없다. */
public final class Size {
    private final int mWidth;
    private final int mHeight;

    public Size(int width, int height) {
        mWidth = width;
        mHeight = height;
    }

    public int getWidth() {
        return mWidth;
    }

    public int getHeight() {
        return mHeight;
    }

    @Override
    public boolean equals(Object obj) {
        if (obj == null) return false;
        if (this == obj) return true;
        if (obj instanceof Size) {
            Size other = (Size) obj;
            return mWidth == other.mWidth && mHeight == other.mHeight;
        }
        return false;
    }

    /** "너비x높이" */
    @Override
    public String toString() {
        return mWidth + "x" + mHeight;
    }

    private static NumberFormatException invalidSize(String s) {
        return new NumberFormatException("Invalid Size: \"" + s + "\"");
    }

    /** "너비*높이" 또는 "너비x높이"(toString의 반대). 형식이 틀리면 NumberFormatException. */
    public static Size parseSize(String string) throws NumberFormatException {
        if (string == null) throw new NullPointerException("string must not be null");
        int sepIx = string.indexOf('*');
        if (sepIx < 0) sepIx = string.indexOf('x');
        if (sepIx < 0) throw invalidSize(string);
        try {
            return new Size(Integer.parseInt(string.substring(0, sepIx)), Integer.parseInt(string.substring(sepIx + 1)));
        } catch (NumberFormatException e) {
            throw invalidSize(string);
        }
    }

    @Override
    public int hashCode() {
        // 같은 크기의 가로·세로를 바꾼 것이 다른 해시가 되게 너비의 반쪽을 돌린다
        return mHeight ^ ((mWidth << (Integer.SIZE / 2)) | (mWidth >>> (Integer.SIZE / 2)));
    }
}
