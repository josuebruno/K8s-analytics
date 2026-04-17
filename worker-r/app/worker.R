#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)

get_arg_value <- function(flag, default = NULL) {
  idx <- match(flag, args)
  if (!is.na(idx) && idx < length(args)) {
    return(args[idx + 1])
  }
  return(default)
}

emit <- function(event_type, message = NULL, value = NULL, extra = NULL) {
  payload <- list(type = event_type)
  if (!is.null(message)) payload$message <- message
  if (!is.null(value)) payload$value <- value
  if (!is.null(extra)) payload$extra <- extra

  cat(jsonlite::toJSON(payload, auto_unbox = TRUE), "\n")
  flush.console()
}

fail <- function(message, code = 1) {
  emit("error", message = message)
  quit(status = code)
}

list_artifacts <- function(artifacts_dir) {
  if (!dir.exists(artifacts_dir)) {
    return(list())
  }

  files <- list.files(artifacts_dir, recursive = TRUE, full.names = TRUE)
  files <- files[file.info(files)$isdir == FALSE]

  result <- list()
  for (f in files) {
    rel <- sub(
      paste0("^", normalizePath(artifacts_dir, winslash = "/"), "/?"),
      "",
      normalizePath(f, winslash = "/")
    )
    size <- file.info(f)$size

    result[[length(result) + 1]] <- list(
      name = basename(f),
      path = f,
      relative_path = rel,
      type = if (grepl("\\.png$", f, ignore.case = TRUE)) "image/png"
             else if (grepl("\\.jpg$|\\.jpeg$", f, ignore.case = TRUE)) "image/jpeg"
             else if (grepl("\\.svg$", f, ignore.case = TRUE)) "image/svg+xml"
             else if (grepl("\\.json$", f, ignore.case = TRUE)) "application/json"
             else "application/octet-stream",
      size_bytes = unname(size)
    )
  }

  return(result)
}

write_json <- function(path, data) {
  jsonlite::write_json(data, path = path, auto_unbox = TRUE, pretty = TRUE)
}

execute_user_code <- function(code_file, output_dir) {
  if (!file.exists(code_file)) {
    fail(paste("Código não encontrado:", code_file))
  }

  artifacts_dir <- file.path(output_dir, "artifacts")
  dir.create(artifacts_dir, recursive = TRUE, showWarnings = FALSE)

  emit("log", message = paste("Executando código do usuário:", code_file))
  emit("progress", message = "Iniciando execução do código", value = 20)

  stdout_file <- file.path(output_dir, "stdout.log")
  stderr_file <- file.path(output_dir, "stderr.log")

  result_code <- system2(
    command = "Rscript",
    args = c(code_file),
    stdout = stdout_file,
    stderr = stderr_file,
    env = c(
      paste0("OUTPUT_DIR=", output_dir),
      paste0("ARTIFACTS_DIR=", artifacts_dir)
    )
  )

  artifacts <- list_artifacts(artifacts_dir)

  stdout_preview <- ""
  stderr_preview <- ""

  if (file.exists(stdout_file)) {
    stdout_preview <- paste(readLines(stdout_file, warn = FALSE), collapse = "\n")
  }

  if (file.exists(stderr_file)) {
    stderr_preview <- paste(readLines(stderr_file, warn = FALSE), collapse = "\n")
  }

  result <- list(
    status = if (result_code == 0) "success" else "failed",
    mode = "inline_code_execution_r",
    returncode = result_code,
    stdout_log = stdout_file,
    stderr_log = stderr_file,
    artifacts = artifacts,
    stdout_preview = substr(stdout_preview, 1, 2000),
    stderr_preview = substr(stderr_preview, 1, 2000)
  )

  write_json(file.path(output_dir, "result.json"), result)

  emit("log", message = paste("stdout salvo em", stdout_file))
  emit("log", message = paste("stderr salvo em", stderr_file))
  emit("log", message = paste("Artefatos encontrados:", length(artifacts)))
  emit("progress", message = "Execução do código concluída", value = 100)
  emit("result", message = "Execução finalizada", extra = list(result_file = file.path(output_dir, "result.json")))

  if (result_code != 0) {
    fail("Código do usuário em R terminou com erro", result_code)
  }
}

main <- function() {
  data_format <- get_arg_value("--data-format", NULL)
  data_path <- get_arg_value("--data-path", NULL)
  ram_limit_gb <- get_arg_value("--ram-limit-gb", "2")
  cpus <- get_arg_value("--cpus", "1")
  output_dir <- get_arg_value("--output-dir", "/output")
  code_file <- get_arg_value("--code-file", NULL)

  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  emit("log", message = "Worker R iniciado")
  emit(
    "log",
    message = "Parâmetros recebidos",
    extra = list(
      data_format = data_format,
      data_path = data_path,
      ram_limit_gb = ram_limit_gb,
      cpus = cpus,
      output_dir = output_dir,
      code_file = code_file
    )
  )

  Sys.sleep(1)

  if (!is.null(code_file) && nzchar(code_file)) {
    execute_user_code(code_file, output_dir)
    return(invisible(NULL))
  }

  emit("log", message = "Execução sem código R informado")
  emit("progress", message = "Finalizando sem código", value = 100)

  result <- list(
    status = "success",
    mode = "no_code_r",
    message = "Execução concluída sem código R",
    artifacts = list()
  )

  write_json(file.path(output_dir, "result.json"), result)
  emit("result", message = "Execução finalizada", extra = list(result_file = file.path(output_dir, "result.json")))
}

suppressPackageStartupMessages({
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    quit(status = 2)
  }
})

main()
