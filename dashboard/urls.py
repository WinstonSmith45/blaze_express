from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/runs", views.api_runs, name="api-runs"),
    path("api/runs/<str:run_id>/<str:name>", views.api_run_file, name="api-run-file"),
    path("api/history", views.api_history, name="api-history"),
]
