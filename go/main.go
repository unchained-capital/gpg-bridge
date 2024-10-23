package main

import (
 	"context"
//    "fmt"
    "log"
    "net/http"
    "time"
	"encoding/json"
	"github.com/getlantern/systray"
    "github.com/gorilla/websocket"
)

// We'll need to define an Upgrader
// this will require a Read and Write buffer size
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
}

func writer(conn *websocket.Conn, results <-chan websocket_result) {
    for result := range results {
		response_json, _ := json.Marshal(result)
	    if err := conn.WriteMessage(websocket.TextMessage, response_json); err != nil {
    	    log.Println(err)
    	}
    }
}


func reader(conn *websocket.Conn, results chan<- websocket_result) {
    for {
        messageType, message, err := conn.ReadMessage()
        if err != nil {
            log.Println(err)
            return
        }

		if messageType == websocket.TextMessage {
	    	process_command(message, results)
	    	close(results)
		}

    }
}

func wsEndpoint(w http.ResponseWriter, r *http.Request) {
    upgrader.CheckOrigin = func(r *http.Request) bool { return true }

    ws, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Println(err)
    }

    // helpful log statement to show connections
    log.Println("Client Connected")

	results := make(chan websocket_result, 5)
	go writer(ws, results)
    reader(ws, results)
}

func setupRoutes() {
    http.HandleFunc("/", wsEndpoint)
}

func onReady() {
	systray.SetTitle("GPG Bridge")
	systray.SetTemplateIcon(Data, Data)

	systray.AddMenuItem("GPG Bridge", "Sign messages with local GPG")
	mQuitOrig := systray.AddMenuItem("Quit", "Quit the app")

	go func() {
		<-mQuitOrig.ClickedCh
		systray.Quit()
	}()
}

func main() {
	server := &http.Server{
		Addr: ":5151",
	}

	onExit := func() {
		shutdownCtx, shutdownRelease := context.WithTimeout(context.Background(), 10*time.Second)
        defer shutdownRelease()

		if err := server.Shutdown(shutdownCtx); err != nil {
            log.Fatalf("HTTP shutdown error: %v", err)
        }
	}

    setupRoutes()
    go func() {
        log.Fatal(server.ListenAndServe())
	}()

	systray.Run(onReady, onExit)
}

