// 동기 파일 눈이다. 동기 file API는 core 프로세스의 module graph에 둘 수 없어
// 이 module은 writer·reader Worker 안에서만 URL로 연다(packages/core/lophn-agent/register.ts).

// 같은 폴더의 임시 파일에 쓴 뒤 rename으로 바꿔 끼운다. 읽는 쪽은 이전 파일 전체나 새 파일 전체만 본다.

// symlink는 lstat로 보고 따라가지 않는다. 상한을 넘는 파일은 읽지 않고 complete false로 알린다.
