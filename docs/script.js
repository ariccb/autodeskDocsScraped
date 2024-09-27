function copyToClipboard(button) {
  const pre = button.nextElementSibling;
  const code = pre.querySelector("code");
  const textArea = document.createElement("textarea");
  textArea.value = code.textContent;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
  button.textContent = "Copied!";
  setTimeout(() => {
    button.textContent = "Copy";
  }, 2000);
}

document.addEventListener("DOMContentLoaded", (event) => {
  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", function () {
      copyToClipboard(this);
    });
  });
});
