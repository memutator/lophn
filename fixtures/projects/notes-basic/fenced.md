---
title: front matter 안의 제목
tags: [fixture, extraction]
# not a heading
---

# 실제 제목

front matter가 끝난 뒤의 진짜 heading이다.

## 코드 블록

본문이다.

```
# fake heading
## 또 다른 가짜 제목
```

코드 블록 안의 heading 모양은 제외한다.

~~~
### tilde fence 안의 가짜 제목
~~~

tilde fence도 같은 대로 제외한다.

## HTML pre

<pre>
# pre heading
## pre 안의 두 번째
</pre>

pre 밖의 heading은 뽑는다.

## 마지막
