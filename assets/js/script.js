$(document).ready(function () {
	var prevScrollpos = window.pageYOffset;

	$(this).scroll(function () {
		if ($(this).scrollTop() > 10) {
			var currentScrollPos = window.pageYOffset;
			if (prevScrollpos > currentScrollPos) {
				$(".header").addClass("header-move");
				$(".header").css("transform", "translateY(0px)");
			} else {
				$(".header").css("transform", "translateY(-100px)");
			}
			prevScrollpos = currentScrollPos;
		}
		prevScrollpos = window.pageYOffset;
	});

	// const items = document.querySelectorAll(".item-description");

	// const observer = new IntersectionObserver(
	//     entries => {
	//     entries.forEach(entry => {
	//         entry.target.classList.toggle("active", entry.isIntersecting);
	//         if(entry.isIntersecting) observer.unobserve(entry.target)
	//     })
	// },
	// {
	//     threshold: 0.4,
	// })

	// items.forEach(item=>{
	//     observer.observe(item);
	// });

	$(".share-btn").click(function () {
		var sharetext = $("title").text();
		var shareurl = window.location.href;

		if (
			navigator.share &&
			typeof sharetext != "undefined" &&
			typeof shareurl != "undefined" &&
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
		) {
			navigator.share({
				title: sharetext,
				text: sharetext,
				url: shareurl,
			});
		} else {
			$(this).next(".share-list").toggle();
		}
	});
});

$(document).mouseup(function (e) {
	var container = $(".share-btn");
	if (!container.is(e.target) && container.has(e.target).length === 0) {
		//    container.hide();

		$(".share-list").slideUp();
	}
});

var pageURL = window.location.href;

function copyToClipboard() {
	var $temp = $("<input>");
	$("body").append($temp);
	$temp.val(pageURL).select();
	document.execCommand("copy");
	$temp.remove();
}
function sendEmail() {
	var subject = "UPDATE THIS";
	var emailBody = pageURL;
	document.location = "mailto:?subject=" + subject + "&body=" + emailBody;
}
function openShareLink(pLink) {
	var popUp = window.open(pLink + pageURL, "popupwindow", "scrollbars=yes,width=740,height=400");
	popUp.focus();
	$(".share-list").hide();
	return false;
}
