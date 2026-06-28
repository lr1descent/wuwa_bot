# Local Memes

Put meme packs in first-level subdirectories under this folder.

Example:

```text
memes/
  西格莉卡/
    001.gif
    002.png
```

Send `meme西格莉卡`, `meme 西格莉卡`, or `meme        西格莉卡` to the bot to
send supported images in that folder as merged forward messages.

Send `meme list` to show all first-level meme packs with supported image counts and total
file sizes.

Large meme packs are split into batches by the plugin. `maxSendCount` controls the total
number of images for one command; `0` means all images. `forwardBatchMaxKb` controls the
maximum cumulative file size for each merged forward message.
