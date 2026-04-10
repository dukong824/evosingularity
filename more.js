const contactForm = document.getElementById("contactForm");
const contactFormUrl = document.getElementById("contactFormUrl");
const contactFormNext = document.getElementById("contactFormNext");
const contactSuccessStatus = document.getElementById("contactSuccessStatus");

if (contactForm && contactFormUrl && contactFormNext) {
  const pageURL = new URL(window.location.href);
  const returnURL = new URL(pageURL.href);

  returnURL.searchParams.set("sent", "1");
  contactFormUrl.value = pageURL.href;
  contactFormNext.value = returnURL.href;
}

if (contactSuccessStatus) {
  const pageURL = new URL(window.location.href);

  if (pageURL.searchParams.get("sent") === "1") {
    contactSuccessStatus.hidden = false;
  }
}
