from django.http import Http404, JsonResponse
from django.shortcuts import render
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .services import runs


@require_GET
def index(request):
    return render(request, "dashboard/index.html")


@require_GET
def api_runs(request):
    return JsonResponse({"runs": runs.list_runs()})


@require_GET
@gzip_page
def api_run_file(request, run_id, name):
    try:
        data = runs.load(run_id, name)
    except runs.RunNotFound:
        raise Http404("Not found")
    return JsonResponse(data, safe=False, json_dumps_params={"ensure_ascii": False})


@require_GET
def api_history(request):
    return JsonResponse({"history": runs.history()})
