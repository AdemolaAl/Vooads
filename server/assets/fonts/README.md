# Fonts for rendered videos

`Inter-ExtraBold.otf` is used by ffmpeg `drawtext` for the kinetic headlines and the end card of animated ads
(`server/stitch.js`). Inter by Rasmus Andersson, SIL Open Font License 1.1 (see `LICENSE-Inter.txt`), which allows
bundling and use in rendered videos. If the file is missing, stitch.js falls back to DejaVu Sans Bold or any bold
system font it can find; set `VIDEO_FONT=/path/to/font.ttf` to use another font.
