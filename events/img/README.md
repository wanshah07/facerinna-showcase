# Event thumbnails

Drop image files here, then write the file name into the `image_url` column of
the events sheet.

    img/pdm-agm.jpg

The page resolves a relative path against its own address, so `img/pdm-agm.jpg`
becomes `https://my.facerinna.com/events/img/pdm-agm.jpg`. A full
`https://...` URL from anywhere else works too.

A row with no image gets the brand gradient with the brand name across it, so
an event without artwork still looks deliberate rather than broken.

Shape: the card crops to 16:9. Anything near 1200x675 is the sweet spot. Keep
faces and text away from the bottom third, which is darkened so a caption over
a bright photo stays readable.

Keep files under about 300 KB. This page is opened on booth wifi.
