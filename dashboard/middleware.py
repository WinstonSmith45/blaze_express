from django.contrib.auth import middleware
from django.http import JsonResponse


class LoginRequiredMiddleware(middleware.LoginRequiredMiddleware):
    """Django's LoginRequiredMiddleware, but API calls get 401 instead of a redirect.

    The page's JavaScript fetches /api/...; a redirect would hand it the login
    page HTML instead of an error it can react to.
    """

    def handle_no_permission(self, request, view_func):
        if request.path_info.startswith("/api/"):
            return JsonResponse({"error": "authentication required"}, status=401)
        return super().handle_no_permission(request, view_func)
