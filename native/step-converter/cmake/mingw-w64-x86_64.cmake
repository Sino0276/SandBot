# Linux에서 MinGW-w64로 Windows용 변환기를 교차 컴파일하는 툴체인
# 예: node scripts/build-step-converter.mjs --toolchain native/step-converter/cmake/mingw-w64-x86_64.cmake --target win32-x64
set (CMAKE_SYSTEM_NAME Windows)
set (CMAKE_SYSTEM_PROCESSOR x86_64)
set (CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-posix)
set (CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++-posix)
set (CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set (CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set (CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set (CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set (CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
